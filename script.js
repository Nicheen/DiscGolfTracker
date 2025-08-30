import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabaseUrl = 'https://yklfurbhvgrsmnfupsey.supabase.co'
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlrbGZ1cmJodmdyc21uZnVwc2V5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY1NjIyMjcsImV4cCI6MjA3MjEzODIyN30.eEeA4Dtnk48oAULw78DWQ4mDplqiDcxv46fiIlTLDsE"
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,     // keeps session in localStorage
    autoRefreshToken: true    // refreshes JWT automatically
  }
});

let coursesData = [];

async function signUp() {
    const email = document.getElementById("login-email").value;
    const password = document.getElementById("login-password").value;

    const { data, error } = await supabase.auth.signUp({
        email,
        password
    });

    if (error) {
        Swal.fire({
            icon: "error",
            title: "Oops...",
            text: error.message,
        });
    } else {
        Swal.fire({
            title: "Successful",
            text: 'Check your email to confirm your account!',
            icon: "success"
        });
    }
}

async function signIn() {
    const email = document.getElementById("login-email").value;
    const password = document.getElementById("login-password").value;

    const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
    });

    if (error) {
        Swal.fire({
            icon: "error",
            title: "Oops...",
            text: error.message,
        });
    } else {
        loginSuccessful();
        loadProfile();
    }
}

async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) {
        Swal.fire({
            icon: "error",
            title: "Oops...",
            text: error.message,
        });
    } else {
        Swal.fire({
            title: "Successfuly Signed out",
            text: 'You are being redirected to the sign in page!',
            icon: "success"
        });
        signOutSuccessful();
    }
}

// Load profile data when logged in
async function loadProfile() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        Swal.fire({
            icon: "error",
            title: "You must login first!",
            text: error.message,
        });
        return;
    }

    // Fill in email field
    document.getElementById("profile-email").value = user.email;

    // Load profile from DB
    const { data, error } = await supabase
        .from("profiles")
        .select("username, bio")
        .eq("id", user.id)
        .single();

    if (data) {
        document.getElementById("profile-username").value = data.username || "";
        document.getElementById("user-name").innerHTML = data.username || "";
        document.getElementById("profile-bio").value = data.bio || "";
    }
}

async function saveProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const username = document.getElementById("profile-username").value;
  const bio = document.getElementById("profile-bio").value;

  const { error } = await supabase.from("profiles").upsert({
    id: user.id,
    username,
    bio,
    updated_at: new Date()
  });

  if (error) {
    Swal.fire({
        icon: "error",
        title: "Error Saving Profile",
        text: error.message,
    });
  } else {
    Swal.fire({
        title: "Profile Saved!",
        icon: "success"
    });
  }
}

async function loadCourses() {
    // Load profile from DB
    const { data, error } = await supabase
        .from("courses")
        .select("id, name, holes, distances")
    
    if (error) {
        console.error("Error loading courses:", error);
        return [];
    } else {
        console.log(data);
    }

    coursesData = data.map(course => ({
        id: course.id,
        name: course.name,
        holes: course.holes.split(',').map(Number),
        distances: course.distances.split(',').map(Number)
    }));

    const select = document.getElementById("course");
    console.log(coursesData);
    coursesData.forEach(course => {
        const option = document.createElement("option");
        option.value = course.id;
        option.textContent = `${course.name} ${course.holes.length}`;
        select.appendChild(option);
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
    for (let hole = 1; hole <= course.holes.length; hole++) {
        const par = course.holes[hole - 1]; // Get par for the current hole
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
    totalHTML += `<div>${course.holes.reduce((a, b) => a + b, 0)}</div>`;
    
    totalRow.innerHTML = totalHTML;
    container.appendChild(totalRow);

    // Update totals initially
    updateTotals();
}

function updateScore(player, holeIndex, change) {
    if (!gameData.currentRound || !gameData.currentRound.scores[player]) return;

    const course = courses[gameData.currentRound.courseId];
    const par = course.holes[holeIndex];

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
        const par = course.holes.reduce((a, b) => a + b, 0);
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

// Add this new function to your script.js file
function loginSuccessful() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('main-app').style.display = 'block';
}

function signOutSuccessful() {
    document.getElementById('login-screen').style.display = 'block';
    document.getElementById('main-app').style.display = 'none';
}

window.showSection = showSection;
window.startRound = startRound;
window.updateScore = updateScore;
window.signOut = signOut;
window.signUp = signUp;
window.signIn = signIn;
window.saveProfile = saveProfile;

// Run on page load
window.addEventListener("DOMContentLoaded", async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    console.log("Restored session:", session.user.email);
    loginSuccessful();
    loadProfile();
    loadCourses();
  } else {
    console.log("User is not logged in");
  }
});