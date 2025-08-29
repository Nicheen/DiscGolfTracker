// Game data storage
let currentUser = null;
let isAuthenticated = false;

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

// Course configurations
const courses = {
    "oakwood-park": { name: "Oakwood Park", holes: 18, pars: [3,3,3,4,3,3,4,3,3,3,3,4,3,3,3,4,3,3] },
    "riverside-course": { name: "Riverside Course", holes: 9, pars: [3,3,4,3,3,3,4,3,3] },
    "mountain-view": { name: "Mountain View DGC", holes: 18, pars: [3,3,3,4,3,3,4,3,4,3,3,3,4,3,3,3,4,3] },
    "city-central": { name: "City Central Park", holes: 12, pars: [3,3,3,4,3,3,3,4,3,3,3,4] }
};

// Google OAuth Functions
function handleCredentialResponse(response) {
    try {
        // Decode the JWT token to get user info
        const userInfo = parseJwt(response.credential);
        
        currentUser = {
            id: userInfo.sub,
            name: userInfo.name,
            email: userInfo.email,
            picture: userInfo.picture
        };
        
        loginUser(currentUser);
        
        // Store auth token securely (in a real app, you'd send this to your backend)
        sessionStorage.setItem('auth_token', response.credential);
        
    } catch (error) {
        console.error('Authentication error:', error);
        alert('Login failed. Please try again.');
    }
}

function parseJwt(token) {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonPayload);
}

function loginUser(user) {
    isAuthenticated = true;
    currentUser = user;
    
    // Update UI with user info
    document.getElementById('user-name').textContent = user.name;
    document.getElementById('user-avatar').src = user.picture || '';
    document.getElementById('username').value = user.name;
    document.getElementById('email').value = user.email;
    document.getElementById('players').value = user.name;
    
    // Update game data
    gameData.profile.username = user.name;
    gameData.profile.email = user.email;
    
    // Show main app, hide login
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('main-app').style.display = 'block';
    
    // Load user data (in a real app, you'd fetch this from your backend)
    loadUserData();
}

function signOut() {
    if (window.google && window.google.accounts && window.google.accounts.id) {
        window.google.accounts.id.disableAutoSelect();
    }
    
    // Clear auth data
    currentUser = null;
    isAuthenticated = false;
    sessionStorage.removeItem('auth_token');
    
    // Reset game data
    gameData.rounds = [];
    gameData.currentRound = null;
    
    // Show login screen
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('main-app').style.display = 'none';
}

function loadUserData() {
    // In a real application, you would:
    // 1. Send the auth token to your backend
    // 2. Verify the token server-side
    // 3. Fetch user-specific data from your database
    
    // For now, we'll just initialize with empty data
    console.log('Loading user data for:', currentUser.email);
    
    // Initialize the UI
    loadFriends();
    updateProgress();
}

// Check for existing authentication on page load
function checkAuthentication() {
    const token = sessionStorage.getItem('auth_token');
    if (token) {
        try {
            const userInfo = parseJwt(token);
            // Check if token is still valid (basic check)
            if (userInfo.exp * 1000 > Date.now()) {
                currentUser = {
                    id: userInfo.sub,
                    name: userInfo.name,
                    email: userInfo.email,
                    picture: userInfo.picture
                };
                loginUser(currentUser);
                return;
            }
        } catch (error) {
            console.log('Invalid stored token');
            sessionStorage.removeItem('auth_token');
        }
    }
    
    // Show login screen
    document.getElementById('login-screen').style.display = 'flex';
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
        const row = document.createElement('div');
        row.className = 'hole-row';
        
        let rowHTML = `<div class="hole-number">${hole}</div>`;
        
        players.forEach(player => {
            rowHTML += `<input type="number" class="score-input" min="1" max="10" 
                        onchange="updateScore('${player}', ${hole-1}, this.value)" 
                        placeholder="-">`;
        });
        
        rowHTML += `<div style="text-align: center; font-weight: bold;">${course.pars[hole-1]}</div>`;
        
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
}

// Update score
function updateScore(player, holeIndex, score) {
    if (gameData.currentRound) {
        gameData.currentRound.scores[player][holeIndex] = score ? parseInt(score) : '';
        updateTotals();
    }
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

// Finish round
function finishRound() {
    if (!gameData.currentRound) return;
    
    // Calculate final scores
    const finalRound = {
        ...gameData.currentRound,
        id: Date.now(),
        finalScores: {}
    };
    
    Object.keys(finalRound.scores).forEach(player => {
        const scores = finalRound.scores[player];
        finalRound.finalScores[player] = scores.reduce((sum, score) => sum + (score || 0), 0);
    });
    
    gameData.rounds.push(finalRound);
    gameData.currentRound = null;
    
    alert('Round completed and saved!');
    document.getElementById('scorecard').style.display = 'none';
    document.getElementById('course').value = '';
    document.getElementById('players').value = 'You';
}

// Load history
function loadHistory() {
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
            <div style="display: flex; justify-content: between; align-items: center; margin-bottom: 10px;">
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
            <button class="btn" style="margin-top: 10px; padding: 8px 15px;">Invite to Round</button>
        `;
        
        container.appendChild(card);
    });
}

// Add friend
function addFriend() {
    const username = document.getElementById('friend-username').value.trim();
    if (!username) return;
    
    if (gameData.friends.find(f => f.username === username)) {
        alert('Already friends with this user!');
        return;
    }
    
    gameData.friends.push({
        username: username,
        status: 'offline',
        totalRounds: Math.floor(Math.random() * 50) + 1,
        avgScore: Math.floor(Math.random() * 20) + 40
    });
    
    document.getElementById('friend-username').value = '';
    loadFriends();
    alert(`Friend request sent to ${username}!`);
}

// Save profile
function saveProfile() {
    gameData.profile = {
        username: document.getElementById('username').value,
        email: document.getElementById('email').value,
        favoriteDisc: document.getElementById('favorite-disc').value,
        bio: document.getElementById('bio').value
    };
    alert('Profile saved!');
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
    loadFriends();
    updateProgress();
});
