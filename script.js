import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabaseUrl = 'https://yklfurbhvgrsmnfupsey.supabase.co'
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlrbGZ1cmJodmdyc21uZnVwc2V5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY1NjIyMjcsImV4cCI6MjA3MjEzODIyN30.eEeA4Dtnk48oAULw78DWQ4mDplqiDcxv46fiIlTLDsE"
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,     // keeps session in localStorage
    autoRefreshToken: true    // refreshes JWT automatically
  }
});

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const COURSES_CACHE_DURATION = 10 * 60 * 1000; // 10 minutes

let selectedProfilePicture = null;
let coursesData = [];
let isNewRoundExpanded = true;
let currentRound = null;
let profilePictureCache = {};
let coursesCacheTime = null;
let pendingScoreUpdates = false;
let saveTimeout;
let searchTimeout;

function toggleNewRoundSection() {
    const content = document.getElementById('new-round-content');
    const chevron = document.getElementById('new-round-chevron');
    const toggle = document.getElementById('new-round-toggle');
    
    if (isNewRoundExpanded) {
        // Collapse
        content.style.maxHeight = '0px';
        content.style.paddingTop = '0';
        content.style.paddingBottom = '0';
        chevron.style.transform = 'rotate(-90deg)';
        toggle.querySelector('p').textContent = 'Click to expand and start a new round';
        isNewRoundExpanded = false;
        
        // Store state in localStorage
        localStorage.setItem('newRoundExpanded', 'false');
    } else {
        // Expand
        content.style.maxHeight = '1000px'; // Large enough to accommodate content
        content.style.paddingTop = '';
        content.style.paddingBottom = '';
        chevron.style.transform = 'rotate(0deg)';
        toggle.querySelector('p').textContent = 'Choose course and players to begin';
        isNewRoundExpanded = true;
        
        // Store state in localStorage
        localStorage.setItem('newRoundExpanded', 'true');
    }
}

// Function to auto-collapse when round starts
function autoCollapseNewRound() {
    if (isNewRoundExpanded) {
        toggleNewRoundSection();
    }
}

// Function to restore collapse state on page load
function restoreNewRoundState() {
    const savedState = localStorage.getItem('newRoundExpanded');
    if (savedState === 'false') {
        // Set initial state without animation
        const content = document.getElementById('new-round-content');
        const chevron = document.getElementById('new-round-chevron');
        const toggle = document.getElementById('new-round-toggle');
        
        if (content && chevron && toggle) {
            content.style.maxHeight = '0px';
            content.style.paddingTop = '0';
            content.style.paddingBottom = '0';
            content.style.transition = 'none'; // Disable transition for initial load
            chevron.style.transform = 'rotate(-90deg)';
            toggle.querySelector('p').textContent = 'Click to expand and start a new round';
            isNewRoundExpanded = false;
            
            // Re-enable transition after a short delay
            setTimeout(() => {
                content.style.transition = 'all 0.3s ease-in-out';
            }, 100);
        }
    }
}

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
        loadCourses();
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

async function loadCourses() {
    // Check if we have recent cached data
    if (coursesData.length > 0 && coursesCacheTime && 
        (Date.now() - coursesCacheTime < COURSES_CACHE_DURATION)) {
        return;
    }

    const { data, error } = await supabase
        .from("courses")
        .select("id, name, holes, distances");
    
    if (error) {
        console.error("Error loading courses:", error);
        return [];
    }

    coursesData = data.map(course => ({
        id: course.id,
        name: course.name,
        holes: course.holes.split(',').map(Number),
        distances: course.distances.split(',').map(Number)
    }));

    coursesCacheTime = Date.now();

    // Update the course selection UI
    const courseSelection = document.getElementById("course-selection");
    if (courseSelection) {
        courseSelection.innerHTML = '';
        
        coursesData.forEach(course => {
            const totalPar = course.holes.reduce((a, b) => a + b, 0);
            const avgDistance = Math.round(course.distances.reduce((a, b) => a + b, 0) / course.distances.length);
            const difficulty = getDifficultyLevel(course.name, totalPar, course.holes.length);
            
            const courseCard = document.createElement('div');
            courseCard.className = 'course-card p-4 border-2 border-gray-200 rounded-xl cursor-pointer transition-all duration-200 hover:border-indigo-400 hover:shadow-lg hover:-translate-y-1';
            courseCard.onclick = () => selectCourse(course.id, courseCard);
            
            courseCard.innerHTML = `
                <div class="flex items-center justify-between">
                    <div class="flex-1">
                        <div class="flex items-center gap-2 mb-1">
                            <h3 class="font-bold text-gray-800 text-lg">${course.name}</h3>
                            <span class="difficulty-badge px-2 py-1 rounded-full text-xs font-semibold ${difficulty.class}">
                                ${difficulty.text}
                            </span>
                        </div>
                        <div class="flex items-center gap-4 text-sm text-gray-600">
                            <span class="flex items-center gap-1">
                                <span class="text-indigo-600">🕳️</span>
                                ${course.holes.length} holes
                            </span>
                            <span class="flex items-center gap-1">
                                <span class="text-green-600">⛳</span>
                                Par ${totalPar}
                            </span>
                            <span class="flex items-center gap-1">
                                <span class="text-orange-600">📏</span>
                                ~${avgDistance}m avg
                            </span>
                        </div>
                    </div>
                    <div class="text-2xl ml-4">
                        ${getCourseEmoji(course.name)}
                    </div>
                </div>
            `;
            
            courseSelection.appendChild(courseCard);
        });
    }

    // Also update the old select element if it still exists (for compatibility)
    const select = document.getElementById("course-select");
    if (select && select.children.length <= 1) {
        coursesData.forEach(course => {
            const option = document.createElement("option");
            option.value = course.id;
            option.textContent = `${course.name} (${course.holes.length} holes)`;
            select.appendChild(option);
        });
    }
}

// Helper function to determine difficulty
function getDifficultyLevel(name, par, holes) {
    const avgPar = par / holes;
    const namePattern = name.toLowerCase();
    
    if (namePattern.includes('easy') || avgPar < 3.2) {
        return { class: 'bg-green-100 text-green-700', text: 'Easy' };
    } else if (namePattern.includes('hard') || namePattern.includes('championship') || avgPar > 3.6) {
        return { class: 'bg-red-100 text-red-700', text: 'Hard' };
    } else {
        return { class: 'bg-blue-100 text-blue-700', text: 'Medium' };
    }
}

// Helper function to get course emoji
function getCourseEmoji(name) {
    const namePattern = name.toLowerCase();
    if (namePattern.includes('forest') || namePattern.includes('wood')) return '🌲';
    if (namePattern.includes('park')) return '🏞️';
    if (namePattern.includes('lake') || namePattern.includes('water')) return '🏞️';
    if (namePattern.includes('mountain') || namePattern.includes('hill')) return '⛰️';
    if (namePattern.includes('easy')) return '🟢';
    if (namePattern.includes('hard') || namePattern.includes('championship')) return '🔴';
    return '🥏';
}

// Function to handle course selection
function selectCourse(courseId, cardElement) {
    // Remove selection from all cards
    document.querySelectorAll('.course-card').forEach(card => {
        card.classList.remove('border-indigo-600', 'bg-indigo-50', 'selected-course');
        card.classList.add('border-gray-200');
    });
    
    // Add selection to clicked card
    cardElement.classList.remove('border-gray-200');
    cardElement.classList.add('border-indigo-600', 'bg-indigo-50', 'selected-course');
    
    // Set the hidden input value
    document.getElementById('course').value = courseId;
    
    console.log('Selected course:', courseId);
}

// ===== FRIENDS FUNCTIONALITY =====

// Add a friend by username
async function addFriend() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const friendUsername = document.getElementById('friend-username').value.trim();
    if (!friendUsername) {
        Swal.fire({
            icon: "warning",
            title: "Invalid Input",
            text: "Please enter a username",
        });
        return;
    }

    try {
        // First, find the user by username - remove any extra characters
        const cleanUsername = friendUsername.replace(/[;\s]+$/, ''); // Remove trailing semicolons and spaces
        
        const { data: friendProfile, error: findError } = await supabase
            .from('profiles')
            .select('id, username')
            .eq('username', cleanUsername)
            .single();

        if (findError || !friendProfile) {
            Swal.fire({
                icon: "error",
                title: "User Not Found",
                text: `No user found with username: ${cleanUsername}`,
            });
            return;
        }

        if (friendProfile.id === user.id) {
            Swal.fire({
                icon: "warning",
                title: "Invalid Action",
                text: "You cannot add yourself as a friend!",
            });
            return;
        }

        // Check if friendship already exists
        const { data: existingFriendship } = await supabase
            .from('friendships')
            .select('id')
            .or(`and(user_id.eq.${user.id},friend_id.eq.${friendProfile.id}),and(user_id.eq.${friendProfile.id},friend_id.eq.${user.id})`)
            .single();

        if (existingFriendship) {
            Swal.fire({
                icon: "info",
                title: "Already Friends",
                text: `You are already friends with ${cleanUsername}!`,
            });
            return;
        }

        // Add the friendship
        const { error: insertError } = await supabase
            .from('friendships')
            .insert({
                user_id: user.id,
                friend_id: friendProfile.id,
                status: 'accepted', // For simplicity, auto-accept friendships
                created_at: new Date()
            });

        if (insertError) {
            Swal.fire({
                icon: "error",
                title: "Error Adding Friend",
                text: insertError.message,
            });
        } else {
            Swal.fire({
                title: "Friend Added!",
                text: `${cleanUsername} has been added to your friends list.`,
                icon: "success"
            });
            document.getElementById('friend-username').value = '';
            clearSearchResults();
            loadFriends(); // Reload the friends list
        }
    } catch (error) {
        console.error('Error adding friend:', error);
        Swal.fire({
            icon: "error",
            title: "Error",
            text: "An unexpected error occurred",
        });
    }
}

// Load friends from Supabase
async function loadFriends() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const container = document.getElementById('friends-list');
    container.innerHTML = '<div style="text-align: center;">Loading friends...</div>';

    try {
        // First get friendships
        const { data: friendships, error: friendshipError } = await supabase
            .from('friendships')
            .select('friend_id, user_id')
            .or(`user_id.eq.${user.id},friend_id.eq.${user.id}`)
            .eq('status', 'accepted');

        if (friendshipError) {
            console.error('Error loading friendships:', friendshipError);
            container.innerHTML = '<div style="text-align: center; color: #dc3545;">Error loading friendships</div>';
            return;
        }

        if (!friendships || friendships.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; color: #6c757d; margin: 40px 0;">
                    <p>No friends added yet.</p>
                    <p>Add friends by their username to track their progress!</p>
                </div>
            `;
            return;
        }

        // Get friend IDs
        const friendIds = friendships.map(f => 
            f.user_id === user.id ? f.friend_id : f.user_id
        );

        // Get friend profiles in one query
        const { data: friendProfiles, error: profileError } = await supabase
            .from('profiles')
            .select('id, username, bio, profile_picture_base64')
            .in('id', friendIds);

        if (profileError) {
            console.error('Error loading friend profiles:', profileError);
            container.innerHTML = '<div style="text-align: center; color: #dc3545;">Error loading friend profiles</div>';
            return;
        }

        // Get all rounds for these friends in one query
        const { data: allFriendRounds } = await supabase
            .from('rounds')
            .select('user_id, final_scores')
            .in('user_id', friendIds)
            .eq('status', 'completed');

        container.innerHTML = '';
        container.className = 'space-y-3';

        // Display each friend with their stats
        friendProfiles.forEach(friend => {
            // Calculate stats from their rounds - now each friend should have their own round entries
            const friendRounds = allFriendRounds?.filter(r => r.user_id === friend.id) || [];
            
            // Get scores from final_scores using friend's username
            const scores = friendRounds
                .map(round => {
                    // Try multiple ways to get the score
                    if (round.final_scores && friend.username && round.final_scores[friend.username] != null) {
                        return round.final_scores[friend.username];
                    }
                    // Fallback: check if there's a score by user ID
                    if (round.final_scores_by_id && round.final_scores_by_id[friend.id] != null) {
                        return round.final_scores_by_id[friend.id];
                    }
                    return null;
                })
                .filter(score => score != null);
            
            const totalRounds = scores.length;
            const avgScore = totalRounds > 0 ? (scores.reduce((a, b) => a + b, 0) / totalRounds).toFixed(1) : '-';
            const bestScore = totalRounds > 0 ? Math.min(...scores) : '-';

            const card = document.createElement('div');
            const profilePicSrc = friend.profile_picture_base64 || "./images/user.png";
            card.className = 'friend-card-new bg-white rounded-xl p-4 shadow-md hover:shadow-lg transition-all duration-200 cursor-pointer border border-gray-100 hover:border-indigo-200';
            card.onclick = () => showFriendDetails(friend, { totalRounds, avgScore, bestScore });

            card.innerHTML = `
                <div class="flex items-center justify-between">
                    <div class="flex items-center space-x-3">
                        <img src="${profilePicSrc}" alt="${friend.username}" 
                            class="w-12 h-12 rounded-full border-2 border-indigo-200 object-cover flex-shrink-0">
                        <div class="min-w-0 flex-1">
                            <h4 class="font-semibold text-gray-900 text-sm truncate">${friend.username}</h4>
                            <p class="text-xs text-gray-500 truncate">${friend.bio || 'No bio set'}</p>
                            <div class="flex items-center space-x-3 mt-1 text-xs text-gray-600">
                                <span>${totalRounds} rounds</span>
                            </div>
                        </div>
                    </div>
                    <div class="flex flex-col space-y-1 flex-shrink-0">
                        <button onclick="event.stopPropagation(); addFriendToRound('${friend.username}')" 
                            class="bg-indigo-600 hover:bg-indigo-700 text-white text-xs px-3 py-1.5 rounded-md transition-colors duration-200 font-medium">
                            Invite
                        </button>
                        <button onclick="event.stopPropagation(); removeFriend('${friend.id}', '${friend.username}')" 
                            class="bg-red-500 hover:bg-red-600 text-white text-xs px-3 py-1.5 rounded-md transition-colors duration-200 font-medium">
                            Remove
                        </button>
                    </div>
                </div>
            `;
            
            container.appendChild(card);
        });
    } catch (error) {
        console.error('Error loading friends:', error);
        container.innerHTML = '<div style="text-align: center; color: #dc3545;">Error loading friends</div>';
    }
}

// Add this new function to script.js
async function showFriendDetails(friend, stats) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    try {
        // Get detailed round history for this friend
        const { data: friendRounds, error } = await supabase
            .from('rounds')
            .select('*')
            .eq('user_id', friend.id)
            .eq('status', 'completed')
            .order('created_at', { ascending: false })
            .limit(10);

        if (error) {
            console.error('Error loading friend details:', error);
        }

        const rounds = friendRounds || [];
        const recentRounds = rounds.slice(0, 5);

        let recentRoundsHTML = '';
        if (recentRounds.length > 0) {
            recentRoundsHTML = `
                <div class="mt-6">
                    <h4 class="font-semibold text-gray-800 mb-3">Recent Rounds</h4>
                    <div class="space-y-2">
                        ${recentRounds.map(round => {
                            const score = round.final_scores?.[friend.username] || 'N/A';
                            const course = coursesData.find(c => c.id == round.course_id);
                            const par = course ? course.holes.reduce((a, b) => a + b, 0) : 0;
                            const scoreDiff = typeof score === 'number' && par > 0 ? score - par : null;
                            const scoreDiffText = scoreDiff === null ? '' : scoreDiff > 0 ? `(+${scoreDiff})` : scoreDiff === 0 ? '(E)' : `(${scoreDiff})`;
                            
                            return `
                                <div class="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                                    <div>
                                        <div class="font-medium text-sm">${round.course_name}</div>
                                        <div class="text-xs text-gray-500">${round.date}</div>
                                    </div>
                                    <div class="text-right">
                                        <div class="font-semibold text-sm">${score}</div>
                                        ${scoreDiffText ? `<div class="text-xs text-gray-600">${scoreDiffText}</div>` : ''}
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
        }

        const profilePicSrc = friend.profile_picture_base64 || "./images/user.png";
        
        Swal.fire({
            title: '',
            html: `
                <div class="text-left">
                    <div class="flex items-center space-x-4 mb-6">
                        <img src="${profilePicSrc}" alt="${friend.username}" 
                            class="w-16 h-16 rounded-full border-3 border-indigo-200 object-cover">
                        <div>
                            <h3 class="text-xl font-bold text-gray-900">${friend.username}</h3>
                            <p class="text-gray-600 text-sm">${friend.bio || 'No bio set'}</p>
                        </div>
                    </div>
                    
                    <div class="grid grid-cols-3 gap-4 mb-6">
                        <div class="text-center p-3 bg-indigo-50 rounded-lg">
                            <div class="text-2xl font-bold text-indigo-600">${stats.totalRounds}</div>
                            <div class="text-xs text-gray-600">Total Rounds</div>
                        </div>
                        <div class="text-center p-3 bg-green-50 rounded-lg">
                            <div class="text-2xl font-bold text-green-600">${stats.avgScore}</div>
                            <div class="text-xs text-gray-600">Average Score</div>
                        </div>
                        <div class="text-center p-3 bg-orange-50 rounded-lg">
                            <div class="text-2xl font-bold text-orange-600">${stats.bestScore}</div>
                            <div class="text-xs text-gray-600">Best Score</div>
                        </div>
                    </div>
                    
                    ${recentRoundsHTML}
                    
                    <div class="flex space-x-3 mt-6 pt-4 border-t">
                        <button onclick="addFriendToRound('${friend.username}'); Swal.close()" 
                            class="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white py-2 px-4 rounded-lg font-medium transition-colors duration-200">
                            Invite to Round
                        </button>
                        <button onclick="removeFriend('${friend.id}', '${friend.username}');" 
                            class="bg-red-500 hover:bg-red-600 text-white py-2 px-4 rounded-lg font-medium transition-colors duration-200">
                            Remove Friend
                        </button>
                    </div>
                </div>
            `,
            showConfirmButton: false,
            showCloseButton: true,
            width: '90%',
            maxWidth: '500px'
        });

    } catch (error) {
        console.error('Error showing friend details:', error);
        Swal.fire({
            icon: "error",
            title: "Error",
            text: "Could not load friend details",
        });
    }
}

// Remove a friend
async function removeFriend(friendId, friendUsername) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const result = await Swal.fire({
        title: 'Remove Friend?',
        text: `Are you sure you want to remove ${friendUsername} from your friends list?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#dc3545',
        cancelButtonColor: '#6c757d',
        confirmButtonText: 'Yes, remove'
    });

    if (result.isConfirmed) {
        try {
            const { error } = await supabase
                .from('friendships')
                .delete()
                .or(`and(user_id.eq.${user.id},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${user.id})`);

            if (error) {
                Swal.fire({
                    icon: "error",
                    title: "Error",
                    text: error.message,
                });
            } else {
                Swal.fire({
                    title: "Friend Removed",
                    text: `${friendUsername} has been removed from your friends list.`,
                    icon: "success"
                });
                loadFriends(); // Reload the friends list
            }
        } catch (error) {
            console.error('Error removing friend:', error);
            Swal.fire({
                icon: "error",
                title: "Error",
                text: "An unexpected error occurred",
            });
        }
    }
}

// Add friend to current round players
async function addFriendToRound(friendUsername) {
    // Clean the username and check if it's a guest
    const cleanUsername = friendUsername.trim();
    
    if (cleanUsername.includes('(Guest)')) {
        Swal.fire({
            icon: "warning",
            title: "Cannot Add Guest",
            text: "Guest players cannot be added as friends. They need to create an account first.",
        });
        return;
    }
    
    const playersInput = document.getElementById('players');

    if (!playersInput) {
        Swal.fire({
            icon: "warning",
            title: "No Active Round",
            text: "Please go to the Game section to start a new round first.",
        });
        return;
    }
    
    if (!currentRound) {
        Swal.fire({
            icon: "warning",
            title: "No Active Round",
            text: "Please start a new round first.",
        });
        return;
    }
    
    // Check if friend is already in the round
    if (currentRound.usernameToPlayerId && currentRound.usernameToPlayerId[friendUsername]) {
        Swal.fire({
            icon: "info",
            title: "Already Added",
            text: `${friendUsername} is already in the players list.`,
        });
        return;
    }
    
    try {
        // Get the friend's user ID from their username
        const { data: friendProfile, error: profileError } = await supabase
            .from('profiles')
            .select('id, username')
            .eq('username', friendUsername)
            .single();

        if (profileError || !friendProfile) {
            Swal.fire({
                icon: "error",
                title: "Friend Not Found",
                text: `Could not find user ${friendUsername}. They may have changed their username.`,
            });
            return;
        }

        const friendUserId = friendProfile.id;
        
        // Update the players input field
        const currentPlayers = playersInput.value.split(',').map(p => p.trim()).filter(p => p);
        currentPlayers.push(friendUsername);
        playersInput.value = currentPlayers.join(', ');
        
        // Add the new player to the current round
        currentRound.playerIds.push(friendUserId);
        currentRound.playerIdToUsername[friendUserId] = friendUsername;
        currentRound.usernameToPlayerId[friendUsername] = friendUserId;
        
        // Initialize scores for the new player
        const course = coursesData.find(c => c.id == currentRound.courseId);
        if (course) {
            const newPlayerScores = new Array(course.holes.length).fill(0);
            currentRound.scores[friendUserId] = newPlayerScores;
            console.log(`Initialized scores for ${friendUsername} (${friendUserId}):`, newPlayerScores);
        }
        
        // Save the updated round to Supabase immediately
        const { error } = await supabase
            .from('rounds')
            .update({
                players: currentRound.playerIds.map(id => currentRound.playerIdToUsername[id]), // Old format
                player_ids: currentRound.playerIds, // New format
                player_usernames: currentRound.playerIdToUsername, // New format
                scores: currentRound.scores,
                updated_at: new Date()
            })
            .eq('id', currentRound.id);

        if (error) {
            console.error('Error updating round with new player:', error);
            Swal.fire({
                icon: "error",
                title: "Error",
                text: "Failed to save the new player to the round.",
            });
            // Remove the player from local state if save failed
            const playerIndex = currentRound.playerIds.indexOf(friendUserId);
            if (playerIndex > -1) {
                currentRound.playerIds.splice(playerIndex, 1);
                delete currentRound.scores[friendUserId];
                delete currentRound.playerIdToUsername[friendUserId];
                delete currentRound.usernameToPlayerId[friendUsername];
            }
            return;
        }
        
        console.log('Successfully saved new player to round');
        
        // Recreate the scorecard with the updated players
        if (course) {
            const playerUsernames = currentRound.playerIds.map(id => currentRound.playerIdToUsername[id]);
            createScorecard(course, playerUsernames);
        }
        
        Swal.fire({
            title: "Friend Added to Round!",
            text: `${friendUsername} has been added to the players list and saved.`,
            icon: "success",
            timer: 2000,
            showConfirmButton: false
        });
        
    } catch (error) {
        console.error('Error adding friend to round:', error);
        Swal.fire({
            icon: "error",
            title: "Error",
            text: "Failed to add friend to round.",
        });
    }
}

// Enhanced search function with better UI
async function searchUsers() {
    const searchTerm = document.getElementById('friend-username').value.trim();
    if (!searchTerm || searchTerm.length < 2) {
        clearSearchResults();
        return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Debounce search requests
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(async () => {
        try {
            const { data: profiles, error } = await supabase
                .from('profiles')
                .select('id, username, bio')
                .ilike('username', `%${searchTerm}%`)
                .neq('id', user.id)
                .limit(5);

            if (error) {
                console.error('Error searching users:', error);
                return;
            }

            // Rest of the function remains the same...
            let resultsContainer = document.getElementById('user-search-results');
            if (!resultsContainer) {
                resultsContainer = document.createElement('div');
                resultsContainer.id = 'user-search-results';
                document.getElementById('friend-username').parentNode.appendChild(resultsContainer);
            }

            resultsContainer.innerHTML = '';

            if (profiles && profiles.length > 0) {
                const profileIds = profiles.map(p => p.id);
                const { data: existingFriendships } = await supabase
                    .from('friendships')
                    .select('friend_id, user_id')
                    .or(`and(user_id.eq.${user.id},friend_id.in.(${profileIds.join(',')})),and(friend_id.eq.${user.id},user_id.in.(${profileIds.join(',')}))`);

                const friendIds = new Set();
                if (existingFriendships) {
                    existingFriendships.forEach(f => {
                        friendIds.add(f.user_id === user.id ? f.friend_id : f.user_id);
                    });
                }

                profiles.forEach(profile => {
                    const resultItem = document.createElement('div');
                    resultItem.className = 'search-result-item';
                    
                    const isAlreadyFriend = friendIds.has(profile.id);
                    
                    resultItem.innerHTML = `
                        <div>
                            <strong>${profile.username}</strong>
                            <div style="font-size: 0.9em; color: #6c757d;">${profile.bio || 'No bio'}</div>
                        </div>
                        <div>
                            ${isAlreadyFriend 
                                ? '<span style="color: #28a745; font-weight: bold;">✓ Friends</span>'
                                : `<button class="btn" onclick="sendFriendRequest('${profile.id}', '${profile.username}')" 
                                          style="padding: 5px 10px; font-size: 0.9em;">Add Friend</button>`
                            }
                        </div>
                    `;
                    
                    resultsContainer.appendChild(resultItem);
                });
            } else {
                resultsContainer.innerHTML = '<div style="text-align: center; color: #6c757d; padding: 10px;">No users found matching "' + searchTerm + '"</div>';
            }
        } catch (error) {
            console.error('Error searching users:', error);
        }
    }, 500); // 500ms debounce
}

// Send friend request (simplified - auto-accept for now)
async function sendFriendRequest(friendId, friendUsername) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    try {
        // Clean the username
        const cleanUsername = friendUsername.trim();
        
        // Check if friendship already exists
        const { data: existingFriendship } = await supabase
            .from('friendships')
            .select('id')
            .or(`and(user_id.eq.${user.id},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${user.id})`)
            .single();

        if (existingFriendship) {
            Swal.fire({
                icon: "info",
                title: "Already Friends",
                text: `You are already friends with ${cleanUsername}!`,
            });
            return;
        }

        // Add the friendship (auto-accept for simplicity)
        const { error } = await supabase
            .from('friendships')
            .insert({
                user_id: user.id,
                friend_id: friendId,
                status: 'accepted',
                created_at: new Date()
            });

        if (error) {
            Swal.fire({
                icon: "error",
                title: "Error Adding Friend",
                text: error.message,
            });
        } else {
            Swal.fire({
                title: "Friend Added!",
                text: `${cleanUsername} has been added to your friends list.`,
                icon: "success"
            });
            document.getElementById('friend-username').value = '';
            document.getElementById('user-search-results').innerHTML = '';
            loadFriends(); // Reload the friends list
        }
    } catch (error) {
        console.error('Error sending friend request:', error);
        Swal.fire({
            icon: "error",
            title: "Error",
            text: "An unexpected error occurred",
        });
    }
}

// Clear search results
function clearSearchResults() {
    const resultsContainer = document.getElementById('user-search-results');
    if (resultsContainer) {
        resultsContainer.innerHTML = '';
    }
}

function showSection(sectionId) {
    // Hide all sections
    document.querySelectorAll('.section').forEach(s => {
        s.classList.remove('active');
        s.classList.add('hidden');
    });
    
    // Show selected section
    const targetSection = document.getElementById(sectionId);
    if (targetSection) {
        targetSection.classList.add('active');
        targetSection.classList.remove('hidden');
    }
    
    // Update navigation button states
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('bg-indigo-600', 'text-white');
        btn.classList.add('text-gray-600', 'hover:text-indigo-600', 'hover:bg-indigo-50');
    });
    
    // Find and activate the correct button
    const buttons = document.querySelectorAll('.nav-btn');
    buttons.forEach(btn => {
        const buttonText = btn.querySelector('span:last-child').textContent.toLowerCase();
        if ((sectionId === 'new-round' && buttonText === 'round') ||
            (sectionId === 'history' && buttonText === 'history') ||
            (sectionId === 'progress' && buttonText === 'progress') ||
            (sectionId === 'friends' && buttonText === 'friends') ||
            (sectionId === 'profile' && buttonText === 'profile')) {
            
            btn.classList.remove('text-gray-600', 'hover:text-indigo-600', 'hover:bg-indigo-50');
            btn.classList.add('bg-indigo-600', 'text-white');
        }
    });
    
    // Load data for specific sections
    if (sectionId === 'history') loadHistory();
    if (sectionId === 'progress') updateProgress();
    if (sectionId === 'friends') loadFriends();
}

async function startRound() {
    const courseId = document.getElementById('course').value;
    const playersText = document.getElementById('players').value;
    
    if (!courseId || !playersText) {
        Swal.fire({
            icon: "warning",
            title: "Missing Information",
            text: "Please select a course and enter players",
        });
        return;
    }
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    
    // Get current user's profile
    const { data: profile } = await supabase
        .from('profiles')
        .select('username')
        .eq('id', user.id)
        .single();

    const currentUsername = profile?.username || user.email;
    
    // Find the selected course
    const course = coursesData.find(c => c.id == courseId);
    if (!course) {
        Swal.fire({
            icon: "error",
            title: "Course Not Found",
            text: "Selected course could not be found",
        });
        return;
    }

    let players = playersText.split(',').map(p => p.trim()).filter(p => p);
    
    // Convert player names to user IDs and create player mapping
    const playerIds = [];
    const playerIdToUsername = {};
    const usernameToPlayerId = {};
    const guestPlayers = []; // Store guest players separately

    for (const playerName of players) {
        if (playerName.toLowerCase() === 'you' || playerName === currentUsername || playerName == "") {
            // Current user
            playerIds.push(user.id);
            playerIdToUsername[user.id] = currentUsername;
            usernameToPlayerId[currentUsername] = user.id;
        } else {
            // Try to find user by username
            const { data: playerProfile } = await supabase
                .from('profiles')
                .select('id, username')
                .eq('username', playerName)
                .single();
            
            if (playerProfile) {
                // Registered user
                playerIds.push(playerProfile.id);
                playerIdToUsername[playerProfile.id] = playerProfile.username;
                usernameToPlayerId[playerProfile.username] = playerProfile.id;
            } else {
                // Guest player - store in separate array
                const guestDisplayName = `${playerName} (Guest)`;
                guestPlayers.push(playerName);
                // For local tracking, use a guest identifier
                const guestId = `guest_${playerName.replace(/\s+/g, '_').toLowerCase()}`;
                playerIdToUsername[guestId] = guestDisplayName;
                usernameToPlayerId[guestDisplayName] = guestId;
            }
        }
    }

    console.log('Player IDs that will be saved:', playerIds);
    console.log('Player ID to Username mapping:', playerIdToUsername);
    console.log('Guest players:', guestPlayers);

    // Initialize scores object using player IDs and guest IDs
    const initialScores = {};
    playerIds.forEach(playerId => {
        initialScores[playerId] = new Array(course.holes.length).fill(0);
    });

    guestPlayers.forEach(guestName => {
        const guestId = `guest_${guestName.replace(/\s+/g, '_').toLowerCase()}`;
        initialScores[guestId] = new Array(course.holes.length).fill(0);
    });

    try {
        // Save the round to Supabase - only store registered player IDs in player_ids
        const { data: newRound, error } = await supabase
            .from('rounds')
            .insert({
                user_id: user.id,
                course_id: parseInt(courseId),
                course_name: course.name,
                players: [...playerIds.map(id => playerIdToUsername[id]), ...guestPlayers.map(name => `${name} (Guest)`)], // All players for display
                player_ids: playerIds, // Only registered user IDs
                player_usernames: playerIdToUsername, // Mapping for registered users
                guest_players: guestPlayers, // Store guest players separately
                scores: initialScores,
                date: new Date().toLocaleDateString(),
                status: 'in_progress'
            })
            .select()
            .single();

        if (error) {
            console.error('Error creating round:', error);
            Swal.fire({
                icon: "error",
                title: "Error Creating Round",
                text: error.message,
            });
            return;
        }

        console.log('Created round with player_ids:', newRound.player_ids);

        // Set current round with both registered and guest players
        const allPlayerIds = [...playerIds, ...guestPlayers.map(name => `guest_${name.replace(/\s+/g, '_').toLowerCase()}`)];
        currentRound = {
            id: newRound.id,
            courseId: courseId,
            courseName: course.name,
            playerIds: allPlayerIds, // All players (registered + guests)
            registeredPlayerIds: playerIds, // Keep track of registered players only
            guestPlayers: guestPlayers,
            playerIdToUsername: playerIdToUsername,
            usernameToPlayerId: usernameToPlayerId,
            scores: initialScores,
            date: new Date().toLocaleDateString()
        };

        console.log('Current round registered players:', playerIds);
        console.log('Current round all players:', allPlayerIds);
        
        // Create scorecard using display names
        const allPlayerNames = [...playerIds.map(id => playerIdToUsername[id]), ...guestPlayers.map(name => `${name} (Guest)`)];
        createScorecard(course, allPlayerNames);
        document.getElementById('current-course').textContent = course.name;
        document.getElementById('scorecard').style.display = 'block';

        // Add this at the end of the startRound() function, right before the closing } catch block
        // Auto-collapse the new round section to save space
        autoCollapseNewRound();

        Swal.fire({
            title: "Round Started!",
            text: `Started new round at ${course.name}`,
            icon: "success",
            timer: 2000,
            showConfirmButton: false
        });

    } catch (error) {
        console.error('Error starting round:', error);
        Swal.fire({
            icon: "error",
            title: "Error",
            text: "Failed to start round. Please try again.",
        });
    }
}

// Create scorecard with hole-by-hole view
function createScorecard(course, players) {
    const container = document.getElementById('scorecard-content');
    container.innerHTML = '';
    container.className = 'space-y-4';
    
    // Current hole state
    let currentHole = 0;
    
    // Hole navigation header
    const holeNav = document.createElement('div');
    holeNav.className = 'bg-indigo-600 text-white rounded-xl p-4 mb-4';
    holeNav.innerHTML = `
        <div class="flex justify-between items-center mb-3">
            <button id="prev-hole" onclick="changeHole(-1)" 
                    class="bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded-lg font-medium transition-colors duration-200" 
                    ${currentHole === 0 ? 'disabled style="opacity: 0.5;"' : ''}>
                ← Prev
            </button>
            <div class="text-center">
                <div class="text-2xl font-bold">Hole <span id="current-hole-number">1</span></div>
                <div class="text-indigo-200">Par <span id="current-par">${course.holes[0]}</span> • <span id="current-distance">${course.distances[0]}m</span></div>
            </div>
            <button id="next-hole" onclick="changeHole(1)" 
                    class="bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded-lg font-medium transition-colors duration-200"
                    ${currentHole === course.holes.length - 1 ? 'disabled style="opacity: 0.5;"' : ''}>
                Next →
            </button>
        </div>
        <div class="flex justify-center">
            <div id="hole-dots" class="flex gap-2">
                ${course.holes.map((_, index) => 
                    `<button onclick="goToHole(${index})" 
                             class="hole-dot w-8 h-8 rounded-full text-xs font-bold transition-all duration-200 ${index === 0 ? 'bg-white text-indigo-600' : 'bg-white/20 text-white hover:bg-white/30'}" 
                             data-hole="${index}">${index + 1}</button>`
                ).join('')}
            </div>
        </div>
    `;
    container.appendChild(holeNav);
    
    // Players scoring area
    const playersArea = document.createElement('div');
    playersArea.id = 'players-area';
    playersArea.className = 'space-y-3';
    container.appendChild(playersArea);
    
    // Totals section
    // Replace the existing totals section with this more compact version
    const totalsSection = document.createElement('div');
    totalsSection.className = 'bg-green-600 text-white rounded-xl p-3 mt-4';
    totalsSection.innerHTML = `
        <h3 class="text-base font-bold mb-2 text-center">Round Totals</h3>
        <div id="totals-grid" class="grid gap-2" style="grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));">
            ${players.map(player => `
                <div class="text-center bg-white/10 rounded-lg p-2">
                    <div class="font-medium text-xs truncate" title="${player}">${player.length > 8 ? player.substring(0, 8) + '...' : player}</div>
                    <div id="total-${player.replace(/\s+/g, '-')}" class="text-lg font-bold">-</div>
                </div>
            `).join('')}
        </div>
    `;
    container.appendChild(totalsSection);
    
    // Initialize the display
    updateHoleDisplay(course, players, currentHole);
    updateTotals();
    
    // Store current hole globally for other functions to access
    window.currentHole = currentHole;
    window.courseData = course;
    window.playersData = players;
}

// Update hole display
async function updateHoleDisplay(course, players, holeIndex) {
    const par = course.holes[holeIndex];
    const distance = course.distances[holeIndex];
    
    // Update hole info
    document.getElementById('current-hole-number').textContent = holeIndex + 1;
    document.getElementById('current-par').textContent = par;
    document.getElementById('current-distance').textContent = distance + 'm';
    
    // Update navigation buttons
    const prevBtn = document.getElementById('prev-hole');
    const nextBtn = document.getElementById('next-hole');
    
    if (holeIndex === 0) {
        prevBtn.disabled = true;
        prevBtn.style.opacity = '0.5';
    } else {
        prevBtn.disabled = false;
        prevBtn.style.opacity = '1';
    }
    
    if (holeIndex === course.holes.length - 1) {
        nextBtn.disabled = true;
        nextBtn.style.opacity = '0.5';
    } else {
        nextBtn.disabled = false;
        nextBtn.style.opacity = '1';
    }
    
    // Update hole dots
    document.querySelectorAll('.hole-dot').forEach((dot, index) => {
        if (index === holeIndex) {
            dot.className = 'hole-dot w-8 h-8 rounded-full text-xs font-bold transition-all duration-200 bg-white text-indigo-600';
        } else {
            dot.className = 'hole-dot w-8 h-8 rounded-full text-xs font-bold transition-all duration-200 bg-white/20 text-white hover:bg-white/30';
        }
    });
    
    // Update players area
    const playersArea = document.getElementById('players-area');
    playersArea.innerHTML = '';
    
    // Create player cards asynchronously to load profile pictures
    const createPlayerCard = async (player) => {
        // Get the player ID to access scores properly
        const playerId = currentRound.usernameToPlayerId[player];
        const currentScore = currentRound && currentRound.scores[playerId] ? 
            currentRound.scores[playerId][holeIndex] : 0;
        const displayScore = currentScore > 0 ? currentScore : '-';
        const scoreDiff = currentScore > 0 ? currentScore - par : 0;
        const scoreText = scoreDiff === 0 ? 'E' : scoreDiff > 0 ? `+${scoreDiff}` : scoreDiff.toString();
        
        // Get profile picture (this is now async)
        const profilePicSrc = await getPlayerProfilePicture(player);
        
        const playerCard = document.createElement('div');
        playerCard.className = 'bg-white rounded-xl p-4 shadow-lg border-2 border-gray-100';
        playerCard.innerHTML = `
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                    <img src="${profilePicSrc}" alt="${player}" 
                        class="w-12 h-12 rounded-full border-2 border-indigo-200 object-cover">
                    <div>
                        <div class="font-bold text-gray-800">${player}</div>
                        <div class="text-sm text-gray-600">${scoreText} (${currentScore || par})</div>
                    </div>
                </div>
                <div class="flex items-center gap-2">
                    <button onclick="updateScore('${player}', ${holeIndex}, -1)" 
                            class="w-10 h-10 bg-red-500 hover:bg-red-600 text-white rounded-full text-lg font-bold transition-colors duration-200 flex items-center justify-center">
                        −
                    </button>
                    <div class="w-12 h-12 flex items-center justify-center font-bold text-lg bg-gray-100 rounded-lg border-2 border-gray-300">
                        <span id="score-${player}-${holeIndex}">${displayScore}</span>
                    </div>
                    <button onclick="updateScore('${player}', ${holeIndex}, 1)" 
                            class="w-10 h-10 bg-green-500 hover:bg-green-600 text-white rounded-full text-lg font-bold transition-colors duration-200 flex items-center justify-center">
                        +
                    </button>
                </div>
            </div>
        `;
        return playerCard;
    };

    // Create all player cards
    Promise.all(players.map(createPlayerCard)).then(playerCards => {
        playerCards.forEach(card => playersArea.appendChild(card));
    });
}

async function deleteCurrentRound() {
    if (!currentRound) return;

    const result = await Swal.fire({
        title: 'Delete Current Round?',
        text: 'Are you sure you want to delete this scorecard? All scores will be lost and this action cannot be undone!',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#dc3545',
        cancelButtonColor: '#6c757d',
        confirmButtonText: 'Yes, delete it!',
        cancelButtonText: 'Cancel'
    });

    if (result.isConfirmed) {
        try {
            const { error } = await supabase
                .from('rounds')
                .delete()
                .eq('id', currentRound.id);

            if (error) {
                throw error;
            }

            // Clear current round and hide scorecard
            currentRound = null;
            document.getElementById('scorecard').style.display = 'none';
            document.getElementById('course').value = '';
            document.getElementById('players').value = '';

            Swal.fire({
                title: "Round Deleted!",
                text: 'The scorecard has been deleted successfully.',
                icon: "success",
                timer: 2000,
                showConfirmButton: false
            });

        } catch (error) {
            console.error('Error deleting current round:', error);
            Swal.fire({
                icon: "error",
                title: "Error",
                text: 'Failed to delete round. Please try again.',
            });
        }
    }
}

// Replace the existing getPlayerProfilePicture function
async function getPlayerProfilePicture(playerName) {
    // Check if it's a guest player
    if (playerName.includes('(Guest)')) {
        return "./images/guest.png"; // You can create a guest icon or use a different default
    }
    
    // Check cache first with timestamp
    const cached = profilePictureCache[playerName];
    if (cached && (Date.now() - cached.timestamp < CACHE_DURATION)) {
        return cached.data;
    }
    
    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('profile_picture_base64')
            .eq('username', playerName)
            .single();

        const result = (error || !data?.profile_picture_base64) 
            ? "./images/user.png" 
            : data.profile_picture_base64;
            
        // Cache with timestamp
        profilePictureCache[playerName] = {
            data: result,
            timestamp: Date.now()
        };
        
        return result;
        
    } catch (error) {
        console.error('Error loading profile picture for', playerName, error);
        const fallback = "./images/user.png";
        profilePictureCache[playerName] = {
            data: fallback,
            timestamp: Date.now()
        };
        return fallback;
    }
}

// Helper function to get user ID from username
async function getUserIdFromUsername(username) {
    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('id')
            .eq('username', username)
            .single();
        
        if (error || !data) {
            console.warn(`Could not find user ID for username: ${username}`);
            return null;
        }
        
        return data.id;
    } catch (error) {
        console.error('Error getting user ID:', error);
        return null;
    }
}

// Helper function to get username from user ID
async function getUsernameFromId(userId) {
    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('username')
            .eq('id', userId)
            .single();
        
        if (error || !data) {
            console.warn(`Could not find username for user ID: ${userId}`);
            return `User_${userId.substring(0, 8)}`;
        }
        
        return data.username;
    } catch (error) {
        console.error('Error getting username:', error);
        return `User_${userId.substring(0, 8)}`;
    }
}

// Convert usernames to user IDs for storage
async function convertPlayersToIds(playerUsernames) {
    const playerIds = {};
    const usernames = {};
    
    for (const username of playerUsernames) {
        const userId = await getUserIdFromUsername(username);
        if (userId) {
            playerIds[userId] = username; // Map ID to current username
            usernames[username] = userId; // Map username to ID for lookup
        } else {
            // If we can't find the user, store as guest player
            playerIds[`guest_${username}`] = username;
            usernames[username] = `guest_${username}`;
        }
    }
    
    return { playerIds, usernames };
}

// Navigation functions
function changeHole(direction) {
    const newHole = window.currentHole + direction;
    const maxHole = window.courseData.holes.length - 1;
    
    if (newHole >= 0 && newHole <= maxHole) {
        window.currentHole = newHole;
        updateHoleDisplay(window.courseData, window.playersData, newHole);
    }
}

function goToHole(holeIndex) {
    window.currentHole = holeIndex;
    updateHoleDisplay(window.courseData, window.playersData, holeIndex);
}

async function updateScore(player, holeIndex, change) {
    if (!currentRound) return;
    
    // Convert username to player ID for data storage
    const playerId = currentRound.usernameToPlayerId[player];
    if (!playerId || !currentRound.scores[playerId]) {
        console.error('No current round or player scores not found:', player, playerId);
        return;
    }

    // Find the course to get par information
    const course = coursesData.find(c => c.id == currentRound.courseId);
    if (!course) return;
    
    const par = course.holes[holeIndex];

    // Ensure the scores array exists and has the right length
    if (!Array.isArray(currentRound.scores[playerId])) {
        currentRound.scores[playerId] = new Array(course.holes.length).fill(0);
    }
    
    // Make sure the array is long enough
    while (currentRound.scores[playerId].length < course.holes.length) {
        currentRound.scores[playerId].push(0);
    }

    // Get current score
    let currentScore = currentRound.scores[playerId][holeIndex];

    // Calculate new score
    let newScore;
    if (currentScore === 0 || currentScore === '') {
        newScore = par + change;
    } else {
        newScore = parseInt(currentScore) + change;
    }

    // Ensure score stays within reasonable bounds
    if (newScore < 1) newScore = 1;
    if (newScore > 10) newScore = 10;

    // Update local state
    currentRound.scores[playerId][holeIndex] = newScore;
    
    console.log(`Updated ${player} (${playerId}) hole ${holeIndex + 1} to ${newScore}`);

    // Update display (still use username for UI)
    const scoreElement = document.getElementById(`score-${player}-${holeIndex}`);
    if (scoreElement) {
        scoreElement.textContent = newScore;
    }

    // Update the player's score difference display
    const scoreDiff = newScore - par;
    const scoreText = scoreDiff === 0 ? 'E' : scoreDiff > 0 ? `+${scoreDiff}` : scoreDiff.toString();
    
    const playerCard = scoreElement.closest('.bg-white');
    if (playerCard) {
        const scoreInfo = playerCard.querySelector('.text-sm.text-gray-600');
        if (scoreInfo) {
            scoreInfo.textContent = `${scoreText} (${newScore})`;
        }
    }

    // Update totals
    updateTotals();

    // Save to Supabase
    await saveCurrentRoundScores();
}

// Save current round scores to Supabase
async function saveCurrentRoundScores() {
    if (!currentRound) return;

    // Debounce saves to avoid too many requests
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(async () => {
        try {
            console.log('Saving round scores to database:', currentRound.scores);
            
            const { error } = await supabase
                .from('rounds')
                .update({
                    scores: currentRound.scores,
                    updated_at: new Date()
                })
                .eq('id', currentRound.id);

            if (error) {
                console.error('Error saving scores:', error);
            } else {
                console.log('Scores saved successfully');
            }
        } catch (error) {
            console.error('Error saving round scores:', error);
        }
    }, 1000); // Save after 1 second of no changes
}

function updateTotals() {
    if (!currentRound) return;
    
    // Get the course data to calculate par
    const course = coursesData.find(c => c.id == currentRound.courseId);
    if (!course) return;
    
    const totalPar = course.holes.reduce((sum, par) => sum + par, 0);
    
    Object.keys(currentRound.scores).forEach(playerId => {
        const scores = currentRound.scores[playerId];
        const total = scores.reduce((sum, score) => sum + (parseInt(score) || 0), 0);
        const username = currentRound.playerIdToUsername[playerId];
        const totalElement = document.getElementById(`total-${username.replace(/\s+/g, '-')}`);
        
        if (totalElement) {
            if (total > 0) {
                const scoreToPar = total - totalPar;
                const scoreToParText = scoreToPar === 0 ? 'E' : 
                                     scoreToPar > 0 ? `+${scoreToPar}` : 
                                     scoreToPar.toString();
                
                totalElement.textContent = `${total} (${scoreToParText})`;
            } else {
                totalElement.textContent = '-';
                totalElement.className = 'text-lg font-bold';
            }
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
    if (!currentRound) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    try {
        // Calculate final scores - include both registered users and guests
        const finalScoresByUsername = {};
        
        Object.keys(currentRound.scores).forEach(playerId => {
            const scores = currentRound.scores[playerId];
            const totalScore = scores.reduce((sum, score) => sum + (parseInt(score) || 0), 0);
            
            // Get username for this player ID
            const username = currentRound.playerIdToUsername[playerId];
            if (username) {
                finalScoresByUsername[username] = totalScore;
            }
        });

        // Get all registered player IDs (exclude guests)
        const allRegisteredPlayerIds = currentRound.playerIds.filter(id => !id.startsWith('guest_'));
        
        console.log('All registered player IDs for round completion:', allRegisteredPlayerIds);

        // Update the original round (owned by the creator)
        const { error: updateError } = await supabase
            .from('rounds')
            .update({
                final_scores: finalScoresByUsername,
                status: 'completed',
                player_ids: allRegisteredPlayerIds,
                player_usernames: currentRound.playerIdToUsername,
                guest_players: currentRound.guestPlayers || [],
                players: Object.values(currentRound.playerIdToUsername),
                scores: currentRound.scores,
                updated_at: new Date()
            })
            .eq('id', currentRound.id);

        if (updateError) {
            throw updateError;
        }

        // Create duplicate entries for OTHER registered players (not the creator)
        const otherRegisteredPlayerIds = allRegisteredPlayerIds.filter(id => id !== user.id);
        
        console.log('Creating duplicate rounds for players:', otherRegisteredPlayerIds);
        
        if (otherRegisteredPlayerIds.length > 0) {
            const duplicateRounds = otherRegisteredPlayerIds.map(playerId => ({
                user_id: playerId, // Each player gets their own entry
                course_id: parseInt(currentRound.courseId),
                course_name: currentRound.courseName,
                players: [...allRegisteredPlayerIds.map(id => currentRound.playerIdToUsername[id]), ...(currentRound.guestPlayers || []).map(name => `${name} (Guest)`)],
                player_ids: allRegisteredPlayerIds, // All registered players
                player_usernames: currentRound.playerIdToUsername,
                guest_players: currentRound.guestPlayers || [],
                scores: currentRound.scores,
                final_scores: finalScoresByUsername,
                date: currentRound.date,
                status: 'completed',
                created_at: new Date(),
                updated_at: new Date()
            }));

            console.log('Inserting duplicate rounds:', duplicateRounds);

            const { data: insertedRounds, error: insertError } = await supabase
                .from('rounds')
                .insert(duplicateRounds)
                .select();

            if (insertError) {
                console.error('Error creating duplicate rounds for other players:', insertError);
                // Don't throw here - the main round was saved successfully
                Swal.fire({
                    icon: "warning",
                    title: "Partial Success",
                    text: "Round saved but some player stats may not update. Please check with other players.",
                    timer: 3000
                });
            } else {
                console.log('Successfully created duplicate rounds:', insertedRounds);
            }
        }

        // Clear current round
        currentRound = null;

        Swal.fire({
            title: "Round Completed!",
            text: 'Your round has been saved successfully for all players.',
            icon: "success",
            timer: 3000,
            showConfirmButton: false
        });
        
        document.getElementById('scorecard').style.display = 'none';
        document.getElementById('course').value = '';
        document.getElementById('players').value = 'You';
        
        // Expand new round section after finishing
        if (!isNewRoundExpanded) {
            toggleNewRoundSection();
        }

        // Refresh history if we're on that tab
        const historySection = document.getElementById('history');
        if (historySection && historySection.classList.contains('active')) {
            loadHistory();
        }
        
    } catch (error) {
        console.error('Error finishing round:', error);
        Swal.fire({
            icon: "error",
            title: "Error",
            text: 'Failed to complete round. Please try again.',
        });
    }
}

async function loadHistory() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const container = document.getElementById('history-list');
    container.innerHTML = '<div class="text-center text-gray-500">Loading history...</div>';

    try {
        const { data: rounds, error } = await supabase
            .from('rounds')
            .select('*')
            .eq('user_id', user.id)
            .eq('status', 'completed')
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error loading history:', error);
            container.innerHTML = '<div class="text-center text-red-500">Error loading history</div>';
            return;
        }

        container.innerHTML = '';
        container.className = 'space-y-4';

        if (!rounds || rounds.length === 0) {
            container.innerHTML = '<div class="text-center text-gray-500 py-12">No rounds completed yet. Finish your first round!</div>';
            return;
        }

        // Get current user's profile for score comparison
        const { data: profile } = await supabase
            .from('profiles')
            .select('username')
            .eq('id', user.id)
            .single();

        const currentUsername = profile?.username;

        rounds.forEach(round => {
            // Find course data for par calculation
            const course = coursesData.find(c => c.id == round.course_id);
            const par = course ? course.holes.reduce((a, b) => a + b, 0) : 0;
            
            // Get current user's score - check both formats
            let yourScore = 0;
            if (round.final_scores_by_id && round.final_scores_by_id[user.id]) {
                yourScore = round.final_scores_by_id[user.id];
            } else if (round.final_scores && currentUsername && round.final_scores[currentUsername]) {
                yourScore = round.final_scores[currentUsername];
            }

            // Calculate score difference text
            const scoreDiff = yourScore > 0 && par > 0 ? yourScore - par : null;
            const scoreDiffText = scoreDiff === null ? '' : 
                scoreDiff > 0 ? `+${scoreDiff}` : 
                scoreDiff === 0 ? 'E' : 
                scoreDiff.toString();

            // Display player scores - handle both registered users and guests
            let topPlayers = [];
            if (round.player_usernames && round.final_scores_by_id) {
                topPlayers = Object.entries(round.final_scores_by_id)
                    .map(([playerId, score]) => ({
                        name: round.player_usernames[playerId] || (playerId.startsWith('guest_') ? 'Guest Player' : 'Unknown'),
                        score: score
                    }))
                    .sort((a, b) => a.score - b.score)
                    .slice(0, 3);
            } else if (round.final_scores) {
                topPlayers = Object.entries(round.final_scores)
                    .map(([player, score]) => ({ name: player, score: score }))
                    .sort((a, b) => a.score - b.score)
                    .slice(0, 3);
            }

            const item = document.createElement('div');
            item.className = 'bg-white rounded-xl shadow-md hover:shadow-lg border border-gray-200 cursor-pointer transition-all duration-200 hover:border-indigo-300 overflow-hidden';
            item.onclick = () => viewRoundDetails(round.id);

            item.innerHTML = `
                <div class="p-6">
                    <div class="flex justify-between items-start mb-4">
                        <div>
                            <h3 class="text-xl font-bold text-gray-900 mb-1">${round.course_name}</h3>
                            <p class="text-sm text-gray-500">${round.date}</p>
                        </div>
                        <div class="text-right">
                            <div class="text-2xl font-bold text-indigo-600">${yourScore || '-'}</div>
                            ${scoreDiffText ? `<div class="text-sm font-medium ${scoreDiff > 0 ? 'text-red-500' : scoreDiff < 0 ? 'text-green-500' : 'text-gray-600'}">${scoreDiffText}</div>` : ''}
                        </div>
                    </div>
                    
                    <div class="mb-4">
                        <p class="text-sm text-gray-600 mb-2">Players: ${round.players.join(', ')}
                    </div>
                    
                    ${topPlayers.length > 0 ? `
                        <div class="border-t pt-4">
                            <p class="text-sm font-medium text-gray-700 mb-2">Leaderboard (course par ${par}):</p>
                            <div class="flex flex-wrap gap-2">
                                ${topPlayers.map((player, index) => {
                                    const scoreToPar = player.score - par;
                                    const scoreToParText = scoreToPar === 0 ? 'E' : 
                                                        scoreToPar > 0 ? `+${scoreToPar}` : 
                                                        scoreToPar.toString();
                                    
                                    return `
                                        <span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${
                                            index === 0 ? 'bg-yellow-100 text-yellow-800' : 
                                            index === 1 ? 'bg-gray-100 text-gray-800' : 
                                            'bg-orange-100 text-orange-800'
                                        }">
                                            ${index + 1}. ${player.name}: ${scoreToParText}
                                        </span>
                                    `;
                                }).join('')}
                            </div>
                        </div>
                    ` : ''}
                </div>
            `;

            container.appendChild(item);
        });
    } catch (error) {
        console.error('Error loading history:', error);
        container.innerHTML = '<div class="text-center text-red-500">Error loading history</div>';
    }
}

async function updateProgress() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    try {
        // Get current user's profile
        const { data: profile } = await supabase
            .from('profiles')
            .select('username')
            .eq('id', user.id)
            .single();

        const currentUsername = profile?.username;

        // Load completed rounds
        const { data: rounds, error } = await supabase
            .from('rounds')
            .select('final_scores, course_id, course_name, created_at, scores, player_ids, player_usernames')
            .eq('user_id', user.id)
            .eq('status', 'completed')
            .order('created_at', { ascending: true });

        if (error) {
            console.error('Error loading progress data:', error);
            return;
        }

        // Filter rounds where user actually has a score
        const yourRounds = rounds.filter(round => {
            if (round.final_scores && currentUsername && round.final_scores[currentUsername] != null) {
                return true;
            }
            return false;
        });
        
        document.getElementById('total-rounds').textContent = yourRounds.length;
        
        if (yourRounds.length === 0) {
            // Reset all displays for no data
            document.getElementById('avg-score').textContent = '-';
            document.getElementById('best-round').textContent = '-';
            document.getElementById('avg-par').textContent = '-';
            document.getElementById('last-5-avg').textContent = '-';
            document.getElementById('improvement-trend').textContent = '-';
            document.getElementById('best-course').textContent = 'No rounds yet';
            document.getElementById('score-distribution').innerHTML = '<p class="text-gray-500 text-center">No rounds completed yet</p>';
            document.getElementById('course-performance').innerHTML = '<p class="text-gray-500 text-center">No rounds completed yet</p>';
            return;
        }

        // Calculate detailed statistics
        const roundsWithDetails = yourRounds.map(round => {
            const score = round.final_scores[currentUsername];
            const course = coursesData.find(c => c.id == round.course_id);
            const par = course ? course.holes.reduce((a, b) => a + b, 0) : 0;
            const scoreToPar = par > 0 ? score - par : 0;
            
            // Get hole-by-hole scores for this user
            const userScores = getUserHoleScores(round, user.id, currentUsername);
            
            return {
                ...round,
                score,
                par,
                scoreToPar,
                course,
                holeScores: userScores
            };
        }).filter(round => round.par > 0); // Only include rounds with valid course data

        if (roundsWithDetails.length === 0) {
            document.getElementById('score-distribution').innerHTML = '<p class="text-gray-500 text-center">No valid course data available</p>';
            document.getElementById('course-performance').innerHTML = '<p class="text-gray-500 text-center">No valid course data available</p>';
            return;
        }

        // Basic stats
        const scores = roundsWithDetails.map(r => r.score);
        const scoresToPar = roundsWithDetails.map(r => r.scoreToPar);
        
        const avgScore = (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1);
        const bestScore = Math.min(...scores);
        const bestRound = roundsWithDetails.find(r => r.score === bestScore);
        const avgToPar = (scoresToPar.reduce((a, b) => a + b, 0) / scoresToPar.length).toFixed(1);
        
        document.getElementById('avg-score').textContent = avgScore;
        document.getElementById('best-round').textContent = bestRound ? `${bestScore} (${bestRound.scoreToPar >= 0 ? '+' : ''}${bestRound.scoreToPar})` : bestScore;
        document.getElementById('avg-par').textContent = avgToPar >= 0 ? `+${avgToPar}` : avgToPar;

        // Last 5 rounds average and trend
        const last5 = roundsWithDetails.slice(-5);
        if (last5.length >= 2) {
            const last5ToPar = last5.map(r => r.scoreToPar);
            const last5Avg = (last5ToPar.reduce((a, b) => a + b, 0) / last5ToPar.length).toFixed(1);
            document.getElementById('last-5-avg').textContent = last5Avg >= 0 ? `+${last5Avg}` : last5Avg;
            
            // Calculate trend
            if (roundsWithDetails.length >= 10) {
                const first5ToPar = roundsWithDetails.slice(0, 5).map(r => r.scoreToPar);
                const first5Avg = first5ToPar.reduce((a, b) => a + b, 0) / first5ToPar.length;
                const improvement = first5Avg - parseFloat(last5Avg);
                
                if (improvement > 1) {
                    document.getElementById('improvement-trend').innerHTML = '📈 +' + improvement.toFixed(1);
                    document.getElementById('improvement-trend').className = 'text-2xl font-bold text-green-600';
                } else if (improvement < -1) {
                    document.getElementById('improvement-trend').innerHTML = '📉 ' + improvement.toFixed(1);
                    document.getElementById('improvement-trend').className = 'text-2xl font-bold text-red-600';
                } else {
                    document.getElementById('improvement-trend').innerHTML = '➡️ Steady';
                    document.getElementById('improvement-trend').className = 'text-2xl font-bold text-gray-600';
                }
            } else {
                document.getElementById('improvement-trend').textContent = 'Need more data';
            }
        } else {
            document.getElementById('last-5-avg').textContent = 'Need more rounds';
            document.getElementById('improvement-trend').textContent = '-';
        }

        // Calculate score distribution (birdies, pars, bogeys, etc.)
        const scoreTypes = {
            'Ace (Hole-in-one)': 0,
            'Albatross (-3)': 0,
            'Eagle (-2)': 0,
            'Birdie (-1)': 0,
            'Par (E)': 0,
            'Bogey (+1)': 0,
            'Double Bogey (+2)': 0,
            'Triple+ (+3)': 0
        };

        let totalHoles = 0;

        roundsWithDetails.forEach(round => {
            if (round.holeScores && round.course) {
                round.holeScores.forEach((score, holeIndex) => {
                    if (score > 0 && holeIndex < round.course.holes.length) {
                        const par = round.course.holes[holeIndex];
                        const diff = score - par;
                        totalHoles++;

                        if (score === 1) {
                            scoreTypes['Ace (Hole-in-one)']++;
                        } else if (diff === -3) {
                            scoreTypes['Albatross (-3)']++;
                        } else if (diff === -2) {
                            scoreTypes['Eagle (-2)']++;
                        } else if (diff === -1) {
                            scoreTypes['Birdie (-1)']++;
                        } else if (diff === 0) {
                            scoreTypes['Par (E)']++;
                        } else if (diff === 1) {
                            scoreTypes['Bogey (+1)']++;
                        } else if (diff === 2) {
                            scoreTypes['Double Bogey (+2)']++;
                        } else if (diff >= 3) {
                            scoreTypes['Triple+ (+3)']++;
                        }
                    }
                });
            }
        });

        // Display score distribution
        const distributionContainer = document.getElementById('score-distribution');
        distributionContainer.innerHTML = '';

        Object.entries(scoreTypes).forEach(([type, count]) => {
            const percentage = totalHoles > 0 ? (count / totalHoles * 100).toFixed(1) : 0;
            const color = getScoreTypeColor(type);
            
            if (count > 0 || ['Birdie (-1)', 'Par (E)', 'Bogey (+1)', 'Double Bogey (+2)'].includes(type)) {
                const bar = document.createElement('div');
                bar.className = 'flex items-center justify-between p-3 bg-white rounded-lg';
                bar.innerHTML = `
                    <div class="flex items-center gap-3 flex-1">
                        <span class="font-medium text-sm w-32">${type}</span>
                        <div class="flex-1 bg-gray-200 rounded-full h-6 relative overflow-hidden">
                            <div class="h-full rounded-full ${color}" style="width: ${Math.max(percentage, 2)}%"></div>
                            <span class="absolute inset-0 flex items-center justify-center text-xs font-semibold text-gray-700">
                                ${percentage}%
                            </span>
                        </div>
                        <span class="font-bold text-sm w-8">${count}</span>
                    </div>
                `;
                distributionContainer.appendChild(bar);
            }
        });

        // Course performance analysis
        const courseStats = {};
        roundsWithDetails.forEach(round => {
            const courseName = round.course_name;
            if (!courseStats[courseName]) {
                courseStats[courseName] = {
                    rounds: 0,
                    totalScore: 0,
                    totalToPar: 0,
                    bestScore: Infinity,
                    bestToPar: Infinity
                };
            }
            
            courseStats[courseName].rounds++;
            courseStats[courseName].totalScore += round.score;
            courseStats[courseName].totalToPar += round.scoreToPar;
            courseStats[courseName].bestScore = Math.min(courseStats[courseName].bestScore, round.score);
            courseStats[courseName].bestToPar = Math.min(courseStats[courseName].bestToPar, round.scoreToPar);
        });

        // Find best course (lowest average to par)
        let bestCourseName = '-';
        let bestCourseAvg = Infinity;
        
        Object.entries(courseStats).forEach(([courseName, stats]) => {
            const avgToPar = stats.totalToPar / stats.rounds;
            if (avgToPar < bestCourseAvg) {
                bestCourseAvg = avgToPar;
                bestCourseName = courseName;
            }
        });
        
        document.getElementById('best-course').textContent = bestCourseName;

        // Display course performance
        const courseContainer = document.getElementById('course-performance');
        courseContainer.innerHTML = '';

        Object.entries(courseStats)
            .sort(([,a], [,b]) => (a.totalToPar / a.rounds) - (b.totalToPar / b.rounds))
            .forEach(([courseName, stats]) => {
                const avgScore = (stats.totalScore / stats.rounds).toFixed(1);
                const avgToPar = (stats.totalToPar / stats.rounds).toFixed(1);
                const isPerformanceGood = stats.totalToPar / stats.rounds < 0;
                
                const courseCard = document.createElement('div');
                courseCard.className = 'flex items-center justify-between p-4 bg-white rounded-lg border-l-4 ' + 
                    (isPerformanceGood ? 'border-green-500' : 'border-red-500');
                courseCard.innerHTML = `
                    <div>
                        <h4 class="font-semibold text-gray-800">${courseName}</h4>
                        <p class="text-sm text-gray-600">${stats.rounds} round${stats.rounds !== 1 ? 's' : ''} played</p>
                    </div>
                    <div class="text-right">
                        <div class="font-bold text-lg ${isPerformanceGood ? 'text-green-600' : 'text-red-600'}">
                            ${avgToPar >= 0 ? '+' : ''}${avgToPar}
                        </div>
                        <div class="text-sm text-gray-600">
                            Best: ${stats.bestToPar >= 0 ? '+' : ''}${stats.bestToPar}
                        </div>
                    </div>
                `;
                courseContainer.appendChild(courseCard);
            });

    } catch (error) {
        console.error('Error updating progress:', error);
    }
}

// Helper function to get user's hole scores from a round
function getUserHoleScores(round, userId, username) {
    // Try new format first
    if (round.scores && round.scores[userId]) {
        return round.scores[userId];
    }
    
    // Fallback to old format
    if (round.scores && round.scores[username]) {
        return round.scores[username];
    }
    
    return [];
}

// Helper function to get color for score types
function getScoreTypeColor(type) {
    const colorMap = {
        'Ace (Hole-in-one)': 'bg-gradient-to-r from-purple-500 to-purple-600',
        'Albatross (-3)': 'bg-gradient-to-r from-purple-400 to-purple-500',
        'Eagle (-2)': 'bg-gradient-to-r from-blue-500 to-blue-600',
        'Birdie (-1)': 'bg-gradient-to-r from-green-500 to-green-600',
        'Par (E)': 'bg-gradient-to-r from-gray-400 to-gray-500',
        'Bogey (+1)': 'bg-gradient-to-r from-yellow-500 to-yellow-600',
        'Double Bogey (+2)': 'bg-gradient-to-r from-orange-500 to-orange-600',
        'Triple+ (+3)': 'bg-gradient-to-r from-red-500 to-red-600'
    };
    
    return colorMap[type] || 'bg-gray-400';
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

// Load current round if one exists
async function loadCurrentRound() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    try {
        // Check if there's an in-progress round
        const { data: inProgressRound, error } = await supabase
            .from('rounds')
            .select('*')
            .eq('user_id', user.id)
            .eq('status', 'in_progress')
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (error && error.code !== 'PGRST116') {
            console.error('Error loading current round:', error);
            return;
        }

        if (inProgressRound) {
            if (inProgressRound.status !== 'in_progress') {
                console.log('Round found but status is not in_progress, skipping...');
                return;
            }

            const course = coursesData.find(c => c.id == inProgressRound.course_id);
            if (course) {
                // Handle both old and new data formats, including guest players
                let playerIds, playerIdToUsername, usernameToPlayerId;

                if (inProgressRound.player_ids && inProgressRound.player_usernames) {
                    // New format
                    playerIds = [...inProgressRound.player_ids];
                    playerIdToUsername = { ...inProgressRound.player_usernames };
                    usernameToPlayerId = {};
                    
                    // Add registered players
                    Object.keys(playerIdToUsername).forEach(id => {
                        usernameToPlayerId[playerIdToUsername[id]] = id;
                    });
                    
                    // Add guest players if they exist
                    if (inProgressRound.guest_players && inProgressRound.guest_players.length > 0) {
                        inProgressRound.guest_players.forEach(guestName => {
                            const guestId = `guest_${guestName.replace(/\s+/g, '_').toLowerCase()}`;
                            const guestDisplayName = `${guestName} (Guest)`;
                            playerIds.push(guestId);
                            playerIdToUsername[guestId] = guestDisplayName;
                            usernameToPlayerId[guestDisplayName] = guestId;
                        });
                    }
                } else {
                    // Old format - need to convert usernames to IDs
                    const players = inProgressRound.players || [];
                    playerIds = [];
                    playerIdToUsername = {};
                    usernameToPlayerId = {};
                    
                    for (const playerName of players) {
                        if (playerName.includes('(Guest)')) {
                            // Handle guest player
                            const baseName = playerName.replace(' (Guest)', '');
                            const guestId = `guest_${baseName.replace(/\s+/g, '_').toLowerCase()}`;
                            playerIds.push(guestId);
                            playerIdToUsername[guestId] = playerName;
                            usernameToPlayerId[playerName] = guestId;
                        } else if (playerName === user.email) {
                            // Current user
                            playerIds.push(user.id);
                            playerIdToUsername[user.id] = playerName;
                            usernameToPlayerId[playerName] = user.id;
                        } else {
                            // Look up other registered players
                            const { data: playerProfile } = await supabase
                                .from('profiles')
                                .select('id, username')
                                .eq('username', playerName)
                                .single();
                            
                            if (playerProfile) {
                                playerIds.push(playerProfile.id);
                                playerIdToUsername[playerProfile.id] = playerProfile.username;
                                usernameToPlayerId[playerProfile.username] = playerProfile.id;
                            }
                        }
                    }
                }

                currentRound = {
                    id: inProgressRound.id,
                    courseId: inProgressRound.course_id,
                    courseName: inProgressRound.course_name,
                    playerIds: playerIds,
                    registeredPlayerIds: playerIds.filter(id => !id.startsWith('guest_')),
                    guestPlayers: inProgressRound.guest_players || [],
                    playerIdToUsername: playerIdToUsername,
                    usernameToPlayerId: usernameToPlayerId,
                    scores: inProgressRound.scores,
                    date: inProgressRound.date
                };

                // Update the players input field
                const playerUsernames = playerIds.map(id => playerIdToUsername[id]).filter(name => name);
                document.getElementById('players').value = playerUsernames.join(', ');

                createScorecard(course, playerUsernames);
                document.getElementById('current-course').textContent = course.name;
                document.getElementById('scorecard').style.display = 'block';

                // Restore scores to the UI
                Object.keys(currentRound.scores).forEach(playerId => {
                    const username = currentRound.playerIdToUsername[playerId];
                    if (username && currentRound.scores[playerId]) {
                        currentRound.scores[playerId].forEach((score, holeIndex) => {
                            if (score && score > 0) {
                                const scoreElement = document.getElementById(`score-${username}-${holeIndex}`);
                                if (scoreElement) {
                                    scoreElement.textContent = score;
                                }
                            }
                        });
                    }
                });

                updateTotals();

                Swal.fire({
                    title: "Round Resumed",
                    text: `Continuing your round at ${course.name} with ${playerUsernames.length} players`,
                    icon: "info",
                    timer: 3000,
                    showConfirmButton: false
                });
            }
        } else {
            document.getElementById('scorecard').style.display = 'none';
            currentRound = null;
        }
    } catch (error) {
        console.error('Error loading current round:', error);
    }
}

async function viewRoundDetails(roundId) {
    try {
        const { data: round, error } = await supabase
            .from('rounds')
            .select('*')
            .eq('id', roundId)
            .single();

        if (error || !round) {
            Swal.fire({
                icon: "error",
                title: "Error",
                text: "Could not load round details",
            });
            return;
        }

        // Find course to get par info
        const course = coursesData.find(c => c.id == round.course_id);
        
        // Determine which format to use
        const useNewFormat = round.player_ids && round.player_usernames && round.scores;
        let displayPlayers = [];
        
        if (useNewFormat) {
            displayPlayers = round.player_ids.map(id => round.player_usernames[id] || `User_${id.substring(0, 8)}`);
            // Add guest players if they exist
            if (round.guest_players && round.guest_players.length > 0) {
                displayPlayers = [...displayPlayers, ...round.guest_players.map(name => `${name} (Guest)`)];
            }
        } else {
            displayPlayers = round.players;
        }

        // Convert to Date objects
        const start = new Date(round.created_at);
        const end   = new Date(round.updated_at);

        // Difference in milliseconds
        const diffMs = end - start;

        // Convert to different units
        const diffSeconds = Math.floor(diffMs / 1000);
        const diffMinutes = Math.floor(diffMs / (1000 * 60));
        const diffHours   = Math.floor(diffMs / (1000 * 60 * 60));

        // Create mobile-friendly HTML
        let detailsHTML = `
            <div class="text-left max-h-[70vh] overflow-y-auto">
                <div class="mb-4 pb-3 border-b border-gray-200">
                    <h3 class="text-lg font-bold text-gray-900 mb-1">${round.course_name}</h3>
                    <p class="text-sm text-gray-600"><strong>Date:</strong> ${round.date} (${diffHours}h ${diffMinutes % 60}m ${diffSeconds % 60}s)</p>
                    <p class="text-sm text-gray-600"><strong>Players:</strong> ${displayPlayers.join(', ')}</p>
                </div>
                
                <h4 class="font-semibold text-gray-800 mb-3 text-sm">Hole-by-hole scores:</h4>
        `;

        if (course) {
            // Mobile-optimized table with horizontal scroll
            detailsHTML += `
                <div class="overflow-x-auto mb-4">
                    <table class="min-w-full text-xs border-collapse">
                        <thead>
                            <tr class="bg-gray-100">
                                <th class="border border-gray-300 p-1 text-center font-medium">H</th>
            `;

            // Add player headers (abbreviated)
            displayPlayers.forEach(player => {
                const shortName = player.length > 6 ? player.substring(0, 6) + '.' : player;
                detailsHTML += `<th class="border border-gray-300 p-1 text-center font-medium min-w-[40px]">${shortName}</th>`;
            });
            detailsHTML += `<th class="border border-gray-300 p-1 text-center font-medium">Par</th></tr></thead><tbody>`;

            // Add hole rows
            for (let i = 0; i < course.holes.length; i++) {
                detailsHTML += `<tr class="hover:bg-gray-50"><td class="border border-gray-300 p-1 text-center font-medium">${i + 1}</td>`;
                
                if (useNewFormat) {
                    // Registered players
                    round.player_ids.forEach(playerId => {
                        const score = round.scores[playerId]?.[i] || '-';
                        detailsHTML += `<td class="border border-gray-300 p-1 text-center">${score}</td>`;
                    });
                    // Guest players
                    if (round.guest_players && round.guest_players.length > 0) {
                        round.guest_players.forEach(guestName => {
                            const guestId = `guest_${guestName.replace(/\s+/g, '_').toLowerCase()}`;
                            const score = round.scores[guestId]?.[i] || '-';
                            detailsHTML += `<td class="border border-gray-300 p-1 text-center">${score}</td>`;
                        });
                    }
                } else {
                    displayPlayers.forEach(player => {
                        let score = '-';
                        if (player.includes('(Guest)')) {
                            const baseName = player.replace(' (Guest)', '');
                            const guestId = `guest_${baseName.replace(/\s+/g, '_').toLowerCase()}`;
                            score = round.scores[guestId]?.[i] || '-';
                        } else {
                            score = round.scores[player]?.[i] || '-';
                        }
                        detailsHTML += `<td class="border border-gray-300 p-1 text-center">${score}</td>`;
                    });
                }
                
                detailsHTML += `<td class="border border-gray-300 p-1 text-center font-semibold text-indigo-600">${course.holes[i]}</td></tr>`;
            }

            // Totals row
            detailsHTML += '<tr class="bg-gray-200 font-semibold"><td class="border border-gray-300 p-1 text-center">Tot</td>';
            
            if (useNewFormat) {
                // Totals for registered players
                round.player_ids.forEach(playerId => {
                    const username = round.player_usernames[playerId];
                    const total = round.final_scores?.[username] || '-';
                    detailsHTML += `<td class="border border-gray-300 p-1 text-center">${total}</td>`;
                });
                // Totals for guest players
                if (round.guest_players && round.guest_players.length > 0) {
                    round.guest_players.forEach(guestName => {
                        const guestDisplayName = `${guestName} (Guest)`;
                        const total = round.final_scores?.[guestDisplayName] || '-';
                        detailsHTML += `<td class="border border-gray-300 p-1 text-center">${total}</td>`;
                    });
                }
            } else {
                displayPlayers.forEach(player => {
                    const total = round.final_scores?.[player] || '-';
                    detailsHTML += `<td class="border border-gray-300 p-1 text-center">${total}</td>`;
                });
            }
            
            const totalPar = course.holes.reduce((a, b) => a + b, 0);
            detailsHTML += `<td class="border border-gray-300 p-1 text-center font-bold text-indigo-600">${totalPar}</td></tr>`;
            detailsHTML += '</tbody></table></div>';
        }

        detailsHTML += `
                <div class="mt-4 pt-4 border-t border-gray-200 flex flex-col sm:flex-row gap-2">
                    <button onclick="copyRoundToText('${roundId}')" 
                            class="flex-1 bg-green-600 hover:bg-green-700 text-white text-sm py-2 px-4 rounded-lg font-medium transition-colors duration-200">
                        📋 Copy Round
                    </button>
                    <button onclick="deleteRoundFromDetails('${roundId}')" 
                            class="flex-1 bg-red-600 hover:bg-red-700 text-white text-sm py-2 px-4 rounded-lg font-medium transition-colors duration-200">
                        🗑️ Delete Round
                    </button>
                </div>
            </div>
        `;

        Swal.fire({
            title: "",
            html: detailsHTML,
            width: '95%',
            maxWidth: '500px',
            showCloseButton: true,
            showConfirmButton: false,
            customClass: {
                popup: 'text-left',
                htmlContainer: 'px-2 py-0'
            }
        });

    } catch (error) {
        console.error('Error viewing round details:', error);
    }
}

async function deleteRoundFromDetails(roundId) {
    Swal.close(); // Close the details popup first
    await deleteRound(roundId); // Use the existing delete function
}

async function copyRoundToText(roundId) {
    try {
        const { data: round, error } = await supabase
            .from('rounds')
            .select('*')
            .eq('id', roundId)
            .single();

        if (error || !round) {
            Swal.fire({
                icon: "error",
                title: "Error",
                text: "Could not load round data",
            });
            return;
        }

        // Find course to get hole count
        const course = coursesData.find(c => c.id == round.course_id);
        if (!course) {
            Swal.fire({
                icon: "error",
                title: "Error",
                text: "Could not find course information",
            });
            return;
        }

        let roundText = `${round.course_name} - ${round.date}\n\n`;

        // Determine which format to use and build the text
        const useNewFormat = round.player_ids && round.player_usernames && round.scores;
        
        if (useNewFormat) {
            // New format: use player IDs and usernames mapping
            round.player_ids.forEach(playerId => {
                const playerName = round.player_usernames[playerId] || `User_${playerId.substring(0, 8)}`;
                const playerScores = round.scores[playerId] || [];
                
                // Ensure we have scores for all holes
                const scoresText = course.holes.map((_, index) => 
                    playerScores[index] || '0'
                ).join(' ');
                
                roundText += `${playerName}: ${scoresText}\n`;
            });
        } else {
            // Old format: use players array and scores by username
            round.players.forEach(playerName => {
                const playerScores = round.scores[playerName] || [];
                
                // Ensure we have scores for all holes
                const scoresText = course.holes.map((_, index) => 
                    playerScores[index] || '0'
                ).join(' ');
                
                roundText += `${playerName}: ${scoresText}\n`;
            });
        }

        // Copy to clipboard
        await navigator.clipboard.writeText(roundText.trim());
        
        Swal.fire({
            title: "Round Copied!",
            text: "Round data has been copied to your clipboard",
            icon: "success",
            timer: 2000,
            showConfirmButton: false
        });

    } catch (error) {
        console.error('Error copying round:', error);
        
        // Fallback for browsers that don't support clipboard API
        if (error.name === 'NotAllowedError' || !navigator.clipboard) {
            Swal.fire({
                icon: "info",
                title: "Copy Manually",
                html: `<div style="text-align: left;"><p>Please copy this text manually:</p><textarea readonly style="width: 100%; height: 200px; margin-top: 10px; padding: 10px; border: 1px solid #ccc; border-radius: 4px;">${roundText.trim()}</textarea></div>`,
                width: '80%'
            });
        } else {
            Swal.fire({
                icon: "error",
                title: "Error",
                text: "Failed to copy round data",
            });
        }
    }
}

async function deleteRound(roundId) {
    const result = await Swal.fire({
        title: 'Delete Round?',
        text: 'This action cannot be undone!',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#dc3545',
        cancelButtonColor: '#6c757d',
        confirmButtonText: 'Yes, delete it!'
    });

    if (result.isConfirmed) {
        try {
            const { error } = await supabase
                .from('rounds')
                .delete()
                .eq('id', roundId);

            if (error) {
                throw error;
            }
            
            // Expand new round section after finishing
            if (!isNewRoundExpanded) {
                toggleNewRoundSection();
            }

            Swal.fire({
                title: "Deleted!",
                text: "Round has been deleted.",
                icon: "success",
                timer: 2000
            });

            // Reload history
            loadHistory();

        } catch (error) {
            console.error('Error deleting round:', error);
            Swal.fire({
                icon: "error",
                title: "Error",
                text: "Failed to delete round.",
            });
        }
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

async function uploadProfilePicture(file, userId) {
    try {
        // Create unique filename
        const fileExt = file.name.split('.').pop();
        const fileName = `${userId}-${Date.now()}.${fileExt}`;
        
        // Upload to Supabase Storage
        const { data, error } = await supabase.storage
            .from('profile-pictures')
            .upload(fileName, file, {
                cacheControl: '3600',
                upsert: false
            });

        if (error) {
            throw error;
        }

        // Get public URL
        const { data: { publicUrl } } = supabase.storage
            .from('profile-pictures')
            .getPublicUrl(fileName);

        return { fileName, publicUrl };
    } catch (error) {
        console.error('Error uploading profile picture:', error);
        throw error;
    }
}

async function deleteOldProfilePicture(fileName) {
    if (!fileName || fileName === 'default') return;
    
    try {
        await supabase.storage
            .from('profile-pictures')
            .remove([fileName]);
    } catch (error) {
        console.error('Error deleting old profile picture:', error);
    }
}

// Preview and convert to base64
function previewProfilePicture(event) {
    const file = event.target.files[0];
    if (file) {
        // Validate file size (max 1MB for base64 storage)
        if (file.size > 1 * 1024 * 1024) {
            Swal.fire({
                icon: "error",
                title: "File Too Large",
                text: "Profile picture must be less than 1MB",
            });
            return;
        }

        // Validate file type
        if (!file.type.startsWith('image/')) {
            Swal.fire({
                icon: "error",
                title: "Invalid File Type",
                text: "Please select an image file",
            });
            return;
        }

        const reader = new FileReader();
        reader.onload = function(e) {
            // Compress and resize the image
            compressImage(e.target.result, (compressedBase64) => {
                selectedProfilePicture = compressedBase64;
                document.getElementById('profile-picture-preview').src = compressedBase64;
            });
        };
        reader.readAsDataURL(file);
    }
}

// Compress image to reduce size
function compressImage(base64, callback) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    
    img.onload = function() {
        // Set canvas size (max 200x200)
        const maxSize = 200;
        let { width, height } = img;
        
        if (width > height) {
            if (width > maxSize) {
                height = (height * maxSize) / width;
                width = maxSize;
            }
        } else {
            if (height > maxSize) {
                width = (width * maxSize) / height;
                height = maxSize;
            }
        }
        
        canvas.width = width;
        canvas.height = height;
        
        // Draw and compress
        ctx.drawImage(img, 0, 0, width, height);
        const compressedBase64 = canvas.toDataURL('image/jpeg', 0.7);
        callback(compressedBase64);
    };
    
    img.src = base64;
}

// Update the loadProfile function
async function loadProfile() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        Swal.fire({
            icon: "error",
            title: "You must login first!",
        });
        return;
    }

    // Fill in email field
    document.getElementById("profile-email").value = user.email;

    // Load profile from DB
    const { data, error } = await supabase
        .from("profiles")
        .select("username, bio, profile_picture_base64")
        .eq("id", user.id)
        .single();

    if (data) {
        document.getElementById("profile-username").value = data.username || "";
        document.getElementById("profile-bio").value = data.bio || "";
        
        // Update profile picture
        const profilePicSrc = data.profile_picture_base64 || "./images/user.png";
        document.getElementById("profile-picture-preview").src = profilePicSrc;
        document.getElementById("user-avatar").src = profilePicSrc;
    }
}

// Update the saveProfile function
async function saveProfile() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const username = document.getElementById("profile-username").value;
    const bio = document.getElementById("profile-bio").value;

    try {
        let profileData = {
            id: user.id,
            username,
            bio,
            updated_at: new Date()
        };

        // Add profile picture if selected
        if (selectedProfilePicture) {
            profileData.profile_picture_base64 = selectedProfilePicture;
            
            // Update navigation avatar
            document.getElementById("user-avatar").src = selectedProfilePicture;
            selectedProfilePicture = null; // Clear the selected file
        }

        const { error } = await supabase.from("profiles").upsert(profileData);

        if (error) {
            throw error;
        }

        Swal.fire({
            title: "Profile Saved!",
            icon: "success"
        });

    } catch (error) {
        console.error('Error saving profile:', error);
        Swal.fire({
            icon: "error",
            title: "Error Saving Profile",
            text: error.message,
        });
    }
}

window.showSection = showSection;
window.startRound = startRound;
window.updateScore = updateScore;
window.signOut = signOut;
window.signUp = signUp;
window.signIn = signIn;
window.saveProfile = saveProfile;
window.previewProfilePicture = previewProfilePicture

// Add these to your window exports
window.searchUsers = searchUsers;
window.clearSearchResults = clearSearchResults;
window.sendFriendRequest = sendFriendRequest;
window.removeFriend = removeFriend;
window.addFriendToRound = addFriendToRound;
window.showFriendDetails = showFriendDetails;
window.loadFriends = loadFriends;

window.startRound = startRound;
window.updateScore = updateScore;
window.finishRound = finishRound;
window.viewRoundDetails = viewRoundDetails;
window.deleteRound = deleteRound;
window.updateProgress = updateProgress;
window.loadHistory = loadHistory;
window.changeHole = changeHole;
window.goToHole = goToHole;
window.deleteCurrentRound = deleteCurrentRound;
window.deleteRoundFromDetails = deleteRoundFromDetails;
window.copyRoundToText = copyRoundToText;
window.toggleNewRoundSection = toggleNewRoundSection;
window.autoCollapseNewRound = autoCollapseNewRound;
window.restoreNewRoundState = restoreNewRoundState;

// Update the existing window.addEventListener at the bottom of script.js
window.addEventListener("DOMContentLoaded", async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    console.log("Restored session:", session.user.email);
    loginSuccessful();
    await loadProfile();
    await loadCourses();
    await loadCurrentRound();
    showSection('new-round');
    
    // Restore the new round section collapse state
    setTimeout(restoreNewRoundState, 100);
  } else {
    console.log("User is not logged in");
  }
});