import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/12.2.0/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, updateDoc, arrayUnion } from "https://www.gstatic.com/firebasejs/12.2.0/firebase-firestore.js";

// Initialize Firebase
const app = initializeApp({
  apiKey: "AIzaSyAzKQPIPO4FVAWbBBD-E-hHUOaQGPZnl-Y",
  authDomain: "discgolftracker-162db.firebaseapp.com",
  projectId: "discgolftracker-162db",
  storageBucket: "discgolftracker-162db.firebasestorage.app",
  messagingSenderId: "334737718769",
  appId: "1:334737718769:web:6c40996f1b306ced121850"
});
const auth = getAuth(app);
const db = getFirestore(app);

const provider = new GoogleAuthProvider();

onAuthStateChanged(auth, user => {
    if(user != null) {
        console.log('logged in!');
    } else {
        console.log('No user');
    }
});

let gameData = {
    rounds: [],
    friends: [
        { username: "mike_throws", status: "online", totalRounds: 15, avgScore: 52 },
        { username: "sarah_disc", status: "offline", totalRounds: 23, avgScore: 48 },
        { username: "chain_seeker", status: "online", totalRounds: 31, avgScore: 45 }
    ],
    currentRound: null,
    profile: {
        username: "",
        email: "",
        favoriteDisc: "",
        bio: ""
    }
};

let courses = {};

fetch("courses.json")
    .then(response => response.json())
    .then(data => {
        courses = data;

        const courseSelect = document.getElementById("course");
        Object.entries(courses).forEach(([key, course]) => {
            const option = document.createElement("option");
            option.value = key;
            option.textContent = `${course.name} (${course.holes} holes)`;
            courseSelect.appendChild(option);
        });
    })
    .catch(error => console.error("Error loading courses:", error));


// REWRITE: loginWithGoogle() - This is already correct but needs to be connected
async function loginWithGoogle() {
    try {
        const result = await signInWithPopup(auth, provider);
        const user = result.user;
        
        // Initialize user in Firestore if first time
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);
        
        if (!userSnap.exists()) {
            // First time user - create profile
            await setDoc(userRef, {
                uid: user.uid,
                email: user.email,
                displayName: user.displayName,
                photoURL: user.photoURL,
                createdAt: new Date(),
                stats: {
                    totalRounds: 0,
                    avgScore: 0,
                    bestScore: null
                },
                favoriteDisc: '',
                bio: ''
            });
        }
        
        // Load user data and update UI
        await loadUserData(user);
        
        // Update UI
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('main-app').style.display = 'block';
        
        return user;
    } catch (error) {
        console.error('Login error:', error);
        alert('Failed to login. Please try again.');
    }
}

async function signOut() {
    try {
        await auth.signOut();
        
        // Clear local data
        gameData = {
            rounds: [],
            friends: [],
            currentRound: null,
            profile: {}
        };
        
        // Update UI
        document.getElementById('login-screen').style.display = 'flex';
        document.getElementById('main-app').style.display = 'none';
    } catch (error) {
        console.error('Sign out error:', error);
    }
}

// REWRITE: loadUserData()
async function loadUserData(user) {
    if (!user) {
        user = auth.currentUser;
        if (!user) return;
    }
    
    try {
        // Load user profile
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);
        
        if (userSnap.exists()) {
            const userData = userSnap.data();
            
            // Update profile data
            gameData.profile = {
                username: userData.displayName || user.displayName,
                email: userData.email,
                favoriteDisc: userData.favoriteDisc || '',
                bio: userData.bio || ''
            };
            
            // Update UI elements
            document.getElementById('user-name').textContent = userData.displayName;
            document.getElementById('user-avatar').src = userData.photoURL || '';
            document.getElementById('username').value = userData.displayName;
            document.getElementById('email').value = userData.email;
            document.getElementById('favorite-disc').value = userData.favoriteDisc || '';
            document.getElementById('bio').value = userData.bio || '';
            document.getElementById('players').value = userData.displayName;
        }
        
        // Load rounds
        await loadRounds();
        
        // Load friends
        await loadFriendsFromFirestore();
        
    } catch (error) {
        console.error('Error loading user data:', error);
    }
}

function checkAuthentication() {
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            // User is signed in
            await loadUserData(user);
            document.getElementById('login-screen').style.display = 'none';
            document.getElementById('main-app').style.display = 'block';
        } else {
            // No user signed in
            document.getElementById('login-screen').style.display = 'flex';
            document.getElementById('main-app').style.display = 'none';
        }
    });
}

// Navigation
function showSection(sectionId) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    
    document.getElementById(sectionId).classList.add('active');
    event.target.classList.add('active');
    
    if (sectionId === 'history') loadHistory();
    if (sectionId === 'progress') updateProgress();
    if (sectionId === 'friends') loadFriends();
}

// Start a new round
function startRound() {
    const courseId = document.getElementById('course').value;
    const playersText = document.getElementById('players').value;
    
    if (!courseId || !playersText) {
        alert('Please select a course and enter players');
        return;
    }
    
    const course = courses[courseId];
    const players = playersText.split(',').map(p => p.trim());
    
    gameData.currentRound = {
        courseId: courseId,
        courseName: course.name,
        players: players,
        scores: {},
        date: new Date().toLocaleDateString()
    };
    
    // Initialize scores
    players.forEach(player => {
        gameData.currentRound.scores[player] = new Array(course.holes).fill('');
    });
    
    createScorecard(course, players);
    document.getElementById('current-course').textContent = course.name;
    document.getElementById('scorecard').style.display = 'block';
}

// Create scorecard
function createScorecard(course, players) {
    const container = document.getElementById('scorecard-content');
    container.innerHTML = '';
    
    // Header row
    const headerRow = document.createElement('div');
    headerRow.className = 'hole-row';
    headerRow.style.background = '#667eea';
    headerRow.style.color = 'white';
    headerRow.style.fontWeight = 'bold';
    headerRow.innerHTML = '<div>Hole</div>' + players.map(player => `<div>${player}</div>`).join('') + '<div>Par</div>';
    container.appendChild(headerRow);

    // Hole rows
    for (let hole = 1; hole <= course.holes; hole++) {
        const par = course.pars[hole - 1]; // Get par for the current hole
        const distance = course.distance[hole - 1];
        const row = document.createElement('div');
        row.className = 'hole-row';
        
        let rowHTML = `<div class="hole-number">${hole} (${distance})</div>`;
        
        players.forEach(player => {
            const currentScore = gameData.currentRound.scores[player][hole - 1];
            rowHTML += `
                <div class="score-control flex items-center">
                    <button class="score-decrease" onclick="updateScore('${player}', ${hole-1}, -1)">-</button>
                    <span class="score-display" id="score-${player}-${hole-1}">${currentScore}</span>
                    <button class="score-increase" onclick="updateScore('${player}', ${hole-1}, 1)">+</button>
                </div>
            `;
        });
        
        rowHTML += `<div style="text-align: center; font-weight: bold;">${par}</div>`;
        row.innerHTML = rowHTML;
        container.appendChild(row);
    }
    
    // Total row
    const totalRow = document.createElement('div');
    totalRow.className = 'hole-row';
    totalRow.style.background = '#28a745';
    totalRow.style.color = 'white';
    totalRow.style.fontWeight = 'bold';
    
    let totalHTML = '<div>Total</div>';
    players.forEach(player => {
        totalHTML += `<div id="total-${player.replace(/\s+/g, '-')}">-</div>`;
    });
    totalHTML += `<div>${course.pars.reduce((a, b) => a + b, 0)}</div>`;
    
    totalRow.innerHTML = totalHTML;
    container.appendChild(totalRow);

    // Update totals initially
    updateTotals();
}

function updateScore(player, holeIndex, change) {
    if (!gameData.currentRound || !gameData.currentRound.scores[player]) return;

    const course = courses[gameData.currentRound.courseId];
    const par = course.pars[holeIndex];

    // Get current score, default to undefined if not set
    let currentScore = gameData.currentRound.scores[player][holeIndex];

    // Calculate new score
    let newScore;
    if (currentScore == 0) {
        // If score is uninitialized, set to par + change (e.g., par + 1 for "+", par - 1 for "-")
        newScore = par + change;
    } else {
        // Otherwise, increment/decrement normally, ensuring currentScore is a number
        currentScore = +currentScore;
        newScore = currentScore + change;
    }

    // Ensure score stays within reasonable bounds (e.g., 1 to 10)
    if (newScore < 1) newScore = 1;
    if (newScore > 10) newScore = 10;

    // Store the new score
    gameData.currentRound.scores[player][holeIndex] = newScore;

    // Update display
    document.getElementById(`score-${player}-${holeIndex}`).textContent = newScore;

    // Update totals
    updateTotals();
}

// Update totals
function updateTotals() {
    if (!gameData.currentRound) return;
    
    Object.keys(gameData.currentRound.scores).forEach(player => {
        const scores = gameData.currentRound.scores[player];
        const total = scores.reduce((sum, score) => sum + (score || 0), 0);
        const totalElement = document.getElementById(`total-${player.replace(/\s+/g, '-')}`);
        if (totalElement) {
            totalElement.textContent = total || '-';
        }
    });
}

async function saveRound(roundData) {
    if (!auth.currentUser) return;
    
    try {
        const userRef = doc(db, 'users', auth.currentUser.uid);
        await updateDoc(userRef, {
            rounds: arrayUnion(roundData)
        });
    } catch (error) {
        console.error('Error saving round:', error);
        throw error;
    }
}

// NEW: Load rounds from Firestore
async function loadRounds() {
    if (!auth.currentUser) return;
    
    try {
        const userRef = doc(db, 'users', auth.currentUser.uid);
        const userSnap = await getDoc(userRef);
        
        if (userSnap.exists() && userSnap.data().rounds) {
            gameData.rounds = userSnap.data().rounds;
        } else {
            gameData.rounds = [];
        }
    } catch (error) {
        console.error('Error loading rounds:', error);
        gameData.rounds = [];
    }
}

async function loadGameData() {
    try {
        // Simulate loading from data.json using localStorage
        const data = localStorage.getItem('gameData');
        if (data) {
            gameData = JSON.parse(data);
        } else {
            // Initialize default gameData if not found
            gameData = { rounds: [], currentRound: null };
        }
        // If using a server, uncomment and adjust the following:
        /*
        const response = await fetch('/data.json');
        gameData = await response.json();
        */
    } catch (error) {
        console.error('Error loading game data:', error);
        gameData = { rounds: [], currentRound: null }; // Fallback
    }
}

async function finishRound() {
    if (!gameData.currentRound || !auth.currentUser) return;

    try {
        // Calculate final scores
        const finalRound = {
            ...gameData.currentRound,
            id: Date.now().toString(),
            userId: auth.currentUser.uid,
            timestamp: new Date(),
            finalScores: {}
        };

        Object.keys(finalRound.scores).forEach(player => {
            const scores = finalRound.scores[player];
            finalRound.finalScores[player] = scores.reduce((sum, score) => sum + (score || 0), 0);
        });

        // Save to Firestore
        await saveRound(finalRound);
        
        // Update local data
        gameData.rounds.push(finalRound);
        gameData.currentRound = null;
        
        // Update user stats
        await updateUserStats();

        alert('Round completed and saved!');
        document.getElementById('scorecard').style.display = 'none';
        document.getElementById('course').value = '';
        document.getElementById('players').value = auth.currentUser.displayName;
        
    } catch (error) {
        console.error('Error finishing round:', error);
        alert('Failed to save round. Please try again.');
    }
}

async function loadHistory() {
    // Load gameData from data.json (simulated via localStorage)
    await loadGameData();

    const container = document.getElementById('history-list');
    container.innerHTML = '';

    if (gameData.rounds.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #6c757d; margin: 40px 0;">No rounds played yet. Start your first round!</p>';
        return;
    }

    gameData.rounds.slice().reverse().forEach(round => {
        const item = document.createElement('div');
        item.className = 'history-item';

        const playerScores = Object.entries(round.finalScores)
            .map(([player, score]) => `${player}: ${score}`)
            .join(' | ');

        const course = courses[round.courseId];
        const par = course.pars.reduce((a, b) => a + b, 0);
        const yourScore = round.finalScores['You'] || 0;
        const scoreDiff = yourScore - par;
        const scoreDiffText = scoreDiff > 0 ? `+${scoreDiff}` : scoreDiff.toString();

        item.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <h4>${round.courseName}</h4>
                <span style="color: #6c757d;">${round.date}</span>
            </div>
            <p><strong>Scores:</strong> ${playerScores}</p>
            <p><strong>Your Performance:</strong> ${yourScore} (${scoreDiffText} vs par)</p>
        `;

        container.appendChild(item);
    });
}
// Update progress stats
function updateProgress() {
    const yourRounds = gameData.rounds.filter(round => round.finalScores['You']);
    
    document.getElementById('total-rounds').textContent = yourRounds.length;
    
    if (yourRounds.length > 0) {
        const scores = yourRounds.map(round => round.finalScores['You']);
        const avgScore = (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1);
        const bestScore = Math.min(...scores);
        
        document.getElementById('avg-score').textContent = avgScore;
        document.getElementById('best-score').textContent = bestScore;
        
        // Last 5 rounds average
        const last5 = scores.slice(-5);
        if (last5.length >= 2) {
            const last5Avg = (last5.reduce((a, b) => a + b, 0) / last5.length).toFixed(1);
            document.getElementById('improvement').textContent = last5Avg;
            
            // Simple improvement indicator
            if (last5.length >= 5) {
                const first5Avg = scores.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
                if (parseFloat(last5Avg) < first5Avg) {
                    document.getElementById('improvement').innerHTML = 
                        last5Avg + ' <span class="improvement-badge">Improving!</span>';
                }
            }
        } else {
            document.getElementById('improvement').textContent = 'Need more rounds';
        }
    }
    
    // Update chart placeholder with basic trend info
    const chartEl = document.getElementById('score-chart');
    if (yourRounds.length >= 3) {
        const recent = yourRounds.slice(-3).map(r => r.finalScores['You']);
        const trend = recent[2] < recent[0] ? '📈 Improving trend!' : 
                    recent[2] > recent[0] ? '📉 Work on consistency' : '➡️ Steady performance';
        chartEl.innerHTML = `<div style="text-align: center;"><div style="font-size: 24px; margin-bottom: 10px;">${trend}</div><div>Last 3 scores: ${recent.join(', ')}</div></div>`;
    }
}

// Load friends
function loadFriends() {
    const container = document.getElementById('friends-list');
    container.innerHTML = '';
    
    gameData.friends.forEach(friend => {
        const card = document.createElement('div');
        card.className = 'friend-card';
        
        const statusColor = friend.status === 'online' ? '#28a745' : '#6c757d';
        
        card.innerHTML = `
            <div style="font-size: 24px; margin-bottom: 10px;">👤</div>
            <h4>${friend.username}</h4>
            <p style="color: ${statusColor}; margin: 5px 0;">● ${friend.status}</p>
            <p><strong>${friend.totalRounds}</strong> rounds</p>
            <p>Avg: <strong>${friend.avgScore}</strong></p>
            <button class="btn" style="margin-top: 10px; padding: 8px 15px; onclick="addFriendToRound('${friend.username}')">Invite to Round</button>
        `;
        
        container.appendChild(card);
    });
}

async function addFriend() {
    const username = document.getElementById('friend-username').value.trim();
    if (!username || !auth.currentUser) return;
    
    try {
        // In a real app, you'd search for the user by username
        // For now, create a friend request
        const userRef = doc(db, 'users', auth.currentUser.uid);
        const friendData = {
            username: username,
            status: 'pending',
            addedAt: new Date()
        };
        
        await updateDoc(userRef, {
            friends: arrayUnion(friendData)
        });
        
        gameData.friends.push(friendData);
        document.getElementById('friend-username').value = '';
        loadFriends();
        alert(`Friend request sent to ${username}!`);
        
    } catch (error) {
        console.error('Error adding friend:', error);
        alert('Failed to add friend.');
    }
}

// NEW: Load friends from Firestore
async function loadFriendsFromFirestore() {
    if (!auth.currentUser) return;
    
    try {
        const userRef = doc(db, 'users', auth.currentUser.uid);
        const userSnap = await getDoc(userRef);
        
        if (userSnap.exists() && userSnap.data().friends) {
            gameData.friends = userSnap.data().friends;
        } else {
            gameData.friends = [];
        }
        
        loadFriends(); // Update UI
    } catch (error) {
        console.error('Error loading friends:', error);
    }
}

function addFriendToRound(friendUsername) {
    if (!gameData.currentRound) {
        alert('Please start a round first!');
        return;
    }

    // Check if friend exists
    const friend = gameData.friends.find(f => f.username === friendUsername);
    if (!friend) {
        alert('Friend not found!');
        return;
    }

    if (gameData.currentRound.players.includes(friendUsername)) {
        alert("This friend is already in the current round!");
        return;
    }

    const course = courses[gameData.currentRound.courseId];
    gameData.currentRound.players.push(friendUsername);
    gameData.currentRound.scores[friendUsername] = new Array(course.holes).fill('');

    // Update scorecard
    createScorecard(course, gameData.currentRound.players);

    // Switch to scorecard view
    showSection('scorecard');

    // Update totals
    updateTotals();
}

// REWRITE: saveProfile()
async function saveProfile() {
    if (!auth.currentUser) return;
    
    try {
        const profileData = {
            displayName: document.getElementById('username').value,
            favoriteDisc: document.getElementById('favorite-disc').value,
            bio: document.getElementById('bio').value
        };
        
        const userRef = doc(db, 'users', auth.currentUser.uid);
        await updateDoc(userRef, profileData);
        
        // Update local data
        gameData.profile = {
            ...gameData.profile,
            ...profileData
        };
        
        alert('Profile saved!');
    } catch (error) {
        console.error('Error saving profile:', error);
        alert('Failed to save profile.');
    }
}

async function updateUserStats() {
    if (!auth.currentUser || gameData.rounds.length === 0) return;
    
    try {
        const yourRounds = gameData.rounds.filter(round => 
            round.finalScores[auth.currentUser.displayName] !== undefined
        );
        
        if (yourRounds.length > 0) {
            const scores = yourRounds.map(round => 
                round.finalScores[auth.currentUser.displayName]
            );
            const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
            const bestScore = Math.min(...scores);
            
            const userRef = doc(db, 'users', auth.currentUser.uid);
            await updateDoc(userRef, {
                'stats.totalRounds': yourRounds.length,
                'stats.avgScore': avgScore,
                'stats.bestScore': bestScore
            });
        }
    } catch (error) {
        console.error('Error updating stats:', error);
    }
}

// Add some sample data for demonstration
gameData.rounds = [
    {
        id: 1,
        courseId: "oakwood-park",
        courseName: "Oakwood Park",
        date: "8/25/2025",
        players: ["You", "Mike"],
        finalScores: { "You": 58, "Mike": 62 }
    },
    {
        id: 2,
        courseId: "riverside-course", 
        courseName: "Riverside Course",
        date: "8/27/2025",
        players: ["You", "Sarah"],
        finalScores: { "You": 32, "Sarah": 29 }
    },
    {
        id: 3,
        courseId: "oakwood-park",
        courseName: "Oakwood Park", 
        date: "8/28/2025",
        players: ["You"],
        finalScores: { "You": 55 }
    }
];

// Initialize the page
document.addEventListener('DOMContentLoaded', function() {
    // Check authentication state
    checkAuthentication();
    
    // Add login button listener
    const loginBtn = document.getElementById('google-login-btn');
    if (loginBtn) {
        loginBtn.addEventListener('click', loginWithGoogle);
    }
});
