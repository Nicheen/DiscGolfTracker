import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

import './weather.js';

export const supabaseUrl = 'https://yklfurbhvgrsmnfupsey.supabase.co'
export const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlrbGZ1cmJodmdyc21uZnVwc2V5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY1NjIyMjcsImV4cCI6MjA3MjEzODIyN30.eEeA4Dtnk48oAULw78DWQ4mDplqiDcxv46fiIlTLDsE"
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true
  }
});

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const COURSES_CACHE_DURATION = 10 * 60 * 1000; // 10 minutes
const LOCATION_UPDATE_INTERVAL = 5 * 60 * 1000; // 5 minutes
const INITIAL_COURSE_DISPLAY_COUNT = 2;
const scrollThreshold = 50; // Minimum scroll distance before triggering
const fadeDistance = 100; // Distance over which to fade
const fadeStartDistance = 30; // Start fading after 30px
const fadeCompleteDistance = 70; // Fully transparent at 80px

// Add these variables at the top of script.js
let locationUpdateInterval = null;
let lastLocationUpdate = null;
let currentUserLocation = null; // Add this new variable
let currentHeaderOpacity = 0.95;
let showAllCourses = false;
let sortDirection = 'asc'; // 'asc' or 'desc'
let courseSortBy = 'distance';
let selectedProfilePicture = null;
export let coursesData = [];
export { getUserLocationWithCache, displayCourses };
let isNewRoundExpanded = true;
let currentRound = null;
let profilePictureCache = {};
let coursesCacheTime = null;
let openDateGroup = 0; // Only latest date open by default
let expandedRoundItems = new Set();

// Add loading state management
let isAppLoading = true;
let loadingTimeout = null;

let showScoreDifference = true; // Default to showing score difference (total-par)
let saveTimeout;
let searchTimeout;

// Save user location to Supabase
async function saveUserLocationToSupabase(latitude, longitude, accuracy = null) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;

    try {
        const updateData = {
            last_location_lat: latitude,
            last_location_lon: longitude,
            last_location_updated_at: new Date().toISOString()
        };
        
        // Add accuracy if available
        if (accuracy) {
            updateData.last_location_accuracy = accuracy;
        }

        const { error } = await supabase
            .from('profiles')
            .update(updateData)
            .eq('id', user.id);

        if (error) {
            console.error('Error saving location to Supabase:', error);
            return false;
        }

        console.log('Location saved to Supabase:', { latitude, longitude, accuracy });
        return true;
    } catch (error) {
        console.error('Error saving location:', error);
        return false;
    }
}

// Get user location from Supabase
async function getUserLocationFromSupabase() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('last_location_lat, last_location_lon, last_location_updated_at')
            .eq('id', user.id)
            .single();

        if (error || !data) {
            console.log('No saved location found in Supabase');
            return null;
        }

        const { last_location_lat, last_location_lon, last_location_updated_at } = data;

        // Check if we have valid location data
        if (!last_location_lat || !last_location_lon || !last_location_updated_at) {
            console.log('Incomplete location data in Supabase');
            return null;
        }

        // Check if location is still valid (less than 5 minutes old)
        const lastUpdate = new Date(last_location_updated_at);
        const now = new Date();
        const timeDiff = now - lastUpdate;

        console.log(`Saved location age: ${Math.round(timeDiff / 1000 / 60)} minutes`);

        if (timeDiff < LOCATION_UPDATE_INTERVAL) {
            console.log('Using cached location from Supabase');
            return {
                latitude: parseFloat(last_location_lat),
                longitude: parseFloat(last_location_lon),
                timestamp: lastUpdate,
                fromCache: true
            };
        } else {
            console.log('Cached location is too old, will fetch fresh location');
            return null;
        }
    } catch (error) {
        console.error('Error retrieving location from Supabase:', error);
        return null;
    }
}

// Enhanced location getter that checks cache first
async function getUserLocationWithCache() {
    try {
        // First, try to get location from Supabase cache
        const cachedLocation = await getUserLocationFromSupabase();
        if (cachedLocation) {
            currentUserLocation = cachedLocation;
            lastLocationUpdate = cachedLocation.timestamp.getTime();
            return cachedLocation;
        }

        // If no valid cached location, get fresh location
        console.log('Fetching fresh location from GPS...');
        const freshLocation = await getUserLocation();
        
        if (freshLocation) {
            currentUserLocation = freshLocation;
            lastLocationUpdate = Date.now();
            
            // Save the fresh location to Supabase
            await saveUserLocationToSupabase(freshLocation.latitude, freshLocation.longitude);
            
            return freshLocation;
        }

        return null;
    } catch (error) {
        console.error('Error getting user location with cache:', error);
        return null;
    }
}

// Add this function
function startLocationUpdates() {
    // Update immediately if no recent location
    if (!lastLocationUpdate || (Date.now() - lastLocationUpdate > LOCATION_UPDATE_INTERVAL)) {
        updateUserLocation();
    }
    
    // Set up periodic updates
    locationUpdateInterval = setInterval(updateUserLocation, LOCATION_UPDATE_INTERVAL);
}

// Add this function
function stopLocationUpdates() {
    if (locationUpdateInterval) {
        clearInterval(locationUpdateInterval);
        locationUpdateInterval = null;
    }
}

// Add this function
async function updateUserLocation() {
    try {
        const newLocation = await getUserLocation();
        if (newLocation) {
            currentUserLocation = newLocation;
            lastLocationUpdate = Date.now();

            // Save to Supabase
            await saveUserLocationToSupabase(newLocation.latitude, newLocation.longitude);
            
            // Update courses with new distances
            coursesData.forEach(course => {
                if (course.coordinates) {
                    try {
                        const [lat, lon] = course.coordinates.split(',').map(Number);
                        course.distance = calculateDistance(
                            newLocation.latitude, 
                            newLocation.longitude, 
                            lat, 
                            lon
                        );
                    } catch (error) {
                        console.warn(`Invalid coordinates for course ${course.name}`);
                    }
                }
            });
            
            // Re-sort and display courses if user is on new-round section
            const newRoundSection = document.getElementById('new-round');
            if (newRoundSection && !newRoundSection.classList.contains('hidden')) {
                sortCourses(courseSortBy);
                displayCourses();
            }
        }
    } catch (error) {
        console.error('Error updating location:', error);
    }
}

function toggleNewRoundSection(event) {
    // Only proceed if the click wasn't on a button or interactive element
    if (event && event.target && false) {
        // Don't toggle if clicking on buttons, links, or interactive elements
        if (event.target.tagName === 'BUTTON' || 
            event.target.tagName === 'A' || 
            event.target.closest('button') || 
            event.target.closest('a') ||
            event.target.onclick) {
            return;
        }
    }
    
    const content = document.getElementById('new-round-content');
    const chevron = document.getElementById('new-round-chevron');
    const toggle = document.getElementById('new-round-toggle');
    
    if (isNewRoundExpanded) {
        // Collapse
        content.style.maxHeight = '0px';
        content.style.paddingTop = '0';
        content.style.paddingBottom = '0';
        chevron.style.transform = 'rotate(-90deg)';
        isNewRoundExpanded = false;
        
        // Store state in localStorage
        localStorage.setItem('newRoundExpanded', 'false');
    } else {
        // Expand
        content.style.maxHeight = '1000px'; // Large enough to accommodate content
        content.style.paddingTop = '';
        content.style.paddingBottom = '';
        chevron.style.transform = 'rotate(0deg)';
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

// Sort courses by different criteria with direction support
function sortCourses(sortBy) {
    courseSortBy = sortBy;
    
    coursesData.sort((a, b) => {
        let comparison = 0;
        
        switch (sortBy) {
            case 'distance':
                // Distance sorting
                if (a.distance !== null && b.distance === null) comparison = -1;
                else if (a.distance === null && b.distance !== null) comparison = 1;
                else if (a.distance !== null && b.distance !== null) {
                    comparison = a.distance - b.distance;
                } else {
                    comparison = a.name.localeCompare(b.name);
                }
                break;
            
            case 'name':
                comparison = a.name.localeCompare(b.name);
                break;
            
            case 'difficulty':
                const getDifficultyScore = (course) => {
                    const totalPar = course.holes.reduce((a, b) => a + b, 0);
                    const avgDistance = Math.round(course.distances.reduce((a, b) => a + b, 0) / course.distances.length);
                    const difficulty = getDifficultyLevel(course.name, totalPar, course.holes.length, avgDistance);
                    
                    if (difficulty.text === 'Easy') return 1;
                    if (difficulty.text === 'Medium') return 2;
                    if (difficulty.text === 'Hard') return 3;
                    return 2;
                };
                comparison = getDifficultyScore(a) - getDifficultyScore(b);
                break;
            
            case 'holes':
                comparison = a.holes.length - b.holes.length;
                if (comparison === 0) {
                    comparison = a.name.localeCompare(b.name);
                }
                break;
            
            default:
                comparison = 0;
        }
        
        // Apply sort direction
        return sortDirection === 'desc' ? -comparison : comparison;
    });
}

function displayCourses() {
    // Preserve rain state before clearing
    const rainStates = preserveRainState();
    
    const coursesContainer = document.getElementById('courses-container');
    if (!coursesContainer) return;
    
    coursesContainer.innerHTML = '';
    
    coursesData.forEach((course, index) => {
        const totalPar = course.holes.reduce((a, b) => a + b, 0);
        const avgDistance = Math.round(course.distances.reduce((a, b) => a + b, 0) / course.distances.length);
        const difficulty = getDifficultyLevel(course.name, totalPar, course.holes.length, avgDistance);
        
        const courseCard = document.createElement('div');
        
        // Determine if this is the peek card
        const isPeekCard = !showAllCourses && index === INITIAL_COURSE_DISPLAY_COUNT;
        const isHidden = !showAllCourses && index > INITIAL_COURSE_DISPLAY_COUNT;
        
        if (isHidden) {
            return;
        }
        
        // Base classes
        let cardClasses = 'course-card relative border-2 border-gray-200 rounded-lg cursor-pointer transition-all duration-300';
        
        if (isPeekCard) {
            cardClasses += ' peek-card opacity-40 hover:opacity-60 pointer-events-auto overflow-hidden';
            courseCard.onclick = () => {
                handleShowMoreLess();
                showAllCourses = true;
                displayCourses();
            };
        } else {
            cardClasses += ' p-3 hover:border-indigo-400 hover:shadow-md hover:-translate-y-0.5';
            courseCard.onclick = () => selectCourse(course.id, courseCard);
            courseCard.ondblclick = (e) => {
                e.stopPropagation();
                selectCourse(course.id, courseCard);
                startRound();
            };
        }
        
        courseCard.className = cardClasses;
        courseCard.style.position = 'relative';
        courseCard.style.overflow = 'hidden';
        
        // Store course ID on the element for rain restoration
        courseCard.dataset.courseId = course.id;

        courseCard.innerHTML = `
            ${isPeekCard ? '<div class="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-white z-10 pointer-events-none"></div>' : ''}
            <div class="p-3 ${isPeekCard ? 'relative z-0' : ''} relative">
                <!-- Background emoji with weather overlay -->
                <div class="material-symbols-rounded absolute top-2 right-2 w-34 h-23 flex items-center justify-center text-4xl opacity-20 pointer-events-none z-0">
                    ${getCourseEmoji(course.name)}
                </div>
                
                <!-- Content container with higher z-index -->
                <div class="relative z-10">
                    <div class="flex items-center gap-2 mb-1 flex-wrap">
                        <h3 class="font-bold text-gray-800 text-base truncate">${course.name}</h3>
                        <span class="difficulty-badge px-2 py-0.5 rounded-full text-xs font-semibold ${difficulty.class} flex-shrink-0">
                            ${difficulty.text}
                        </span>
                        ${course.distance !== null ? 
                            `<span class="distance-badge px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700 flex-shrink-0">
                                📍 ${formatDistance(course.distance)}
                            </span>` : ''
                        }
                    </div>
                    <div class="flex items-center gap-3 text-xs text-gray-600">
                        <span class="flex items-center gap-1">
                            <span class="text-indigo-600">🕳️</span>
                            <span class="font-medium">${course.holes.length}</span>
                        </span>
                        <span class="flex items-center gap-1">
                            <span class="text-green-600">⛳</span>
                            <span class="font-medium">${totalPar}</span>
                        </span>
                        <span class="flex items-center gap-1">
                            <span class="text-orange-600">📏</span>
                            <span class="font-medium">~${avgDistance}m</span>
                        </span>
                    </div>
                </div>
            </div>
            ${isPeekCard ? `
                <div class="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
                    <div class="bg-black/10 backdrop-blur-sm rounded-full px-3 py-1">
                        <span class="text-s pb-2 font-medium text-black-700">+${coursesData.length - INITIAL_COURSE_DISPLAY_COUNT} more courses</span>
                    </div>
                </div>
            ` : ''}
        `;
        
        coursesContainer.appendChild(courseCard);
    });

    // In the displayCourses function, add this after creating each courseCard:
    if (course.weather && course.weather.isRaining) {
        console.log(`Course ${course.name} should have rain animation - isRaining: ${course.weather.isRaining}`);
        
        // Apply rain animation immediately if weather indicates rain
        setTimeout(() => {
            if (!courseCard.classList.contains('has-rain')) {
                console.log(`Applying rain animation to ${course.name} during display`);
                createRainAnimation(courseCard, course.weather);
            }
        }, 50);
    }
    
    // Add a "Show Less" button when all courses are shown
    if (showAllCourses && coursesData.length > INITIAL_COURSE_DISPLAY_COUNT) {
        const showLessButton = document.createElement('button');
        showLessButton.className = 'w-full py-2 text-xs text-gray-600 hover:text-gray-800 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors mt-2';
        showLessButton.textContent = 'Show Less';
        showLessButton.onclick = () => {
            handleShowMoreLess();
            showAllCourses = false;
            displayCourses();
        };
        coursesContainer.appendChild(showLessButton);
    }

    // Apply rain animations to new DOM elements after they're in the DOM
    setTimeout(() => {
        restoreRainStateToNewElements(rainStates);
    }, 50); // Small delay to ensure DOM is fully rendered
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

    if (!email || !password) {
        Swal.fire({
            icon: "error",
            title: "Missing Information",
            text: "Please enter both email and password",
        });
        return;
    }

    if (password.length < 6) {
        Swal.fire({
            icon: "error",
            title: "Password Too Short",
            text: "Password must be at least 6 characters long",
        });
        return;
    }

    const { data, error } = await supabase.auth.signUp({
        email,
        password
    });

    if (error) {
        Swal.fire({
            icon: "error",
            title: "Signup Failed",
            text: error.message,
        });
    } else {
        Swal.fire({
            title: "Success!",
            text: 'Account created! Check your email to confirm your account.',
            icon: "success"
        }).then(() => {
            // Switch back to login mode
            switchToLogin();
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

async function signInWithGoogle() {
    try {
        const { data, error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: `${window.location.origin}${window.location.pathname}`
            }
        });

        if (error) {
            Swal.fire({
                icon: "error",
                title: "Google Sign-In Failed",
                text: error.message,
            });
        }
        // Note: The redirect will happen automatically if successful
        // The user will be redirected back and handled by the auth state change listener
    } catch (error) {
        Swal.fire({
            icon: "error",
            title: "Google Sign-In Error",
            text: error.message || "An unexpected error occurred",
        });
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
        // Reset app state before showing success message
        resetAppState();
        
        Swal.fire({
            title: "Successfully Signed out",
            text: 'You are being redirected to the sign in page!',
            icon: "success",
            timer: 2000,
            showConfirmButton: false
        });
        stopLocationUpdates();
        stopWeatherAutoRefresh(); // ADD THIS LINE
        signOutSuccessful();
    }
}

// Load profile data when logged in
async function refreshLocation() {
    const button = event.target;
    const originalText = button.innerHTML;
    button.innerHTML = '🔄 Updating...';
    button.disabled = true;
    
    await updateUserLocation();
    
    button.innerHTML = originalText;
    button.disabled = false;
}

async function loadCourses() {
    // Check if we have recent cached data
    if (coursesData.length > 0 && coursesCacheTime && 
        (Date.now() - coursesCacheTime < COURSES_CACHE_DURATION)) {
        return;
    }

    // Get user location (with cache) - non-blocking
    let userLocation = null;
    try {
        userLocation = await getUserLocationWithCache(); // Changed this line
    } catch (error) {
        console.log('Could not get user location, courses will not be sorted by distance');
    }

    const { data, error } = await supabase
        .from("courses")
        .select("id, name, holes, distances, coordinates");
    
    if (error) {
        console.error("Error loading courses:", error);
        return [];
    }

    coursesData = data.map(course => {
        const courseData = {
            id: course.id,
            name: course.name,
            holes: course.holes.split(',').map(Number),
            distances: course.distances.split(',').map(Number),
            coordinates: course.coordinates
        };

        // Calculate distance if user location is available and course has coordinates
        if (userLocation && course.coordinates) {
            try {
                const [lat, lon] = course.coordinates.split(',').map(Number);
                courseData.distance = calculateDistance(
                    userLocation.latitude, 
                    userLocation.longitude, 
                    lat, 
                    lon
                );
            } catch (coordError) {
                console.warn(`Invalid coordinates for course ${course.name}:`, course.coordinates);
                courseData.distance = null;
            }
        } else {
            courseData.distance = null;
        }

        return courseData;
    });

    // Sort courses by distance (closest first), then by name
    coursesData.sort((a, b) => {
        if (a.distance !== null && b.distance === null) return -1;
        if (a.distance === null && b.distance !== null) return 1;
        if (a.distance !== null && b.distance !== null) {
            return a.distance - b.distance;
        }
        return a.name.localeCompare(b.name);
    });

    coursesCacheTime = Date.now();

    // Update the course selection UI - replace the existing courseSelection.innerHTML = '' section with:
    const courseSelection = document.getElementById("course-selection");
    const distanceElement = document.getElementById("distance-tracker");

    if (courseSelection) {
        // In your loadCourses function, replace the distance tracker section with:
        // Add this to the course selection UI in loadCourses()
        distanceElement.innerHTML = `
            <div class="flex items-center justify-between w-full">
                <div class="flex items-center gap-1">
                    <div class="flex items-center gap-2">
                        <h2 class="text-xl font-bold text-gray-800">New Round</h2>
                        ${userLocation ? 
                            '<button onclick="refreshLocationFromBadge(event)" class="px-2 py-1 bg-green-100 hover:bg-green-200 text-green-700 text-xs rounded-full transition-colors duration-200 cursor-pointer">📍 Sorted by distance</button>' : 
                            '<span class="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded-full">📍 Location disabled</span>'
                        }
                    </div>
                </div>
            </div>
        `;
        // Update the course selection UI - replace the existing courseSelection.innerHTML section with:
        courseSelection.innerHTML = `
            <div id="courses-container" class="space-y-2">
                <!-- Courses will be inserted here -->
            </div>
        `;
        
        // Add event listener for sort changes
        const sortSelect = document.getElementById('course-sort');
        if (sortSelect) {
            sortSelect.addEventListener('change', (e) => {
                sortCourses(e.target.value);
                displayCourses();
            });
        }
    }

    // Set default sort based on location availability
    courseSortBy = userLocation ? 'distance' : 'name';
    
    // Sort courses
    sortCourses(courseSortBy);

    // Load weather for all courses
    await loadWeatherForAllCourses();
    
    // Display courses
    displayCourses();
    
    // Update sort selector and direction button to match current sort
    const sortSelect = document.getElementById('course-sort');

    if (sortSelect) {
        sortSelect.value = courseSortBy;
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

function toggleDateGroup(dateIndex) {
    const content = document.getElementById(`date-content-${dateIndex}`);
    const chevron = document.getElementById(`date-chevron-${dateIndex}`);
    
    if (!content || !chevron) return;

    // If clicking on already open group, close it
    if (openDateGroup === dateIndex && !content.classList.contains('max-h-0')) {
        content.classList.add('max-h-0');
        content.style.maxHeight = '0px';
        chevron.style.transform = 'rotate(0deg)';
        openDateGroup = -1; // No group open
        return;
    }

    // Close currently open group
    if (openDateGroup !== -1) {
        const currentContent = document.getElementById(`date-content-${openDateGroup}`);
        const currentChevron = document.getElementById(`date-chevron-${openDateGroup}`);
        if (currentContent && currentChevron) {
            currentContent.classList.add('max-h-0');
            currentContent.style.maxHeight = '0px';
            currentChevron.style.transform = 'rotate(0deg)';
        }
    }

    // Open clicked group
    content.classList.remove('max-h-0');
    content.style.maxHeight = '2000px'; // Large enough for content
    chevron.style.transform = 'rotate(180deg)';
    openDateGroup = dateIndex;
}

async function refreshLocationFromBadge(event) {
    // Stop the event from bubbling up to the toggle button
    event.stopPropagation();
    event.preventDefault();
    
    const button = event.target;
    const originalText = button.innerHTML;
    button.innerHTML = '🔄 Updating...';
    button.disabled = true;
    
    try {
        // Get high-accuracy location
        const freshLocation = await getHighAccuracyLocation();
        if (freshLocation) {
            currentUserLocation = freshLocation;
            lastLocationUpdate = Date.now();
            
            // Save to Supabase with accuracy
            await saveUserLocationToSupabase(
                freshLocation.latitude, 
                freshLocation.longitude, 
                freshLocation.accuracy
            );
            
            // Update courses with new distances
            coursesData.forEach(course => {
                if (course.coordinates) {
                    try {
                        const [lat, lon] = course.coordinates.split(',').map(Number);
                        course.distance = calculateDistance(
                            freshLocation.latitude, 
                            freshLocation.longitude, 
                            lat, 
                            lon
                        );
                    } catch (error) {
                        console.warn(`Invalid coordinates for course ${course.name}`);
                    }
                }
            });
            
            // Re-sort and display courses
            sortCourses(courseSortBy);
            displayCourses();
            
            const accuracyText = freshLocation?.accuracy ? 
                ` (±${Math.round(freshLocation.accuracy)}m)` : '';
            
            // Show success toast
            Swal.fire({
                title: "Location Updated",
                text: `Courses re-sorted by distance${accuracyText}`,
                icon: "success",
                timer: 2000,
                showConfirmButton: false,
                toast: true,
                position: 'top-end'
            });
            
            // Update the badge text to show it was refreshed
            button.innerHTML = '📍 Sorted by distance';
        } else {
            throw new Error('Could not get location');
        }
    } catch (error) {
        console.error('Error refreshing location from badge:', error);
        Swal.fire({
            title: "Location Update Failed",
            text: "Could not refresh location",
            icon: "error",
            timer: 2000,
            showConfirmButton: false,
            toast: true,
            position: 'top-end'
        });
        button.innerHTML = originalText;
    } finally {
        button.disabled = false;
    }
}

async function refreshLocationFromButton(event) {
    // Stop the event from bubbling up to the toggle button
    event.stopPropagation();
    event.preventDefault();
    
    const button = event.target;
    const originalText = button.innerHTML;
    button.innerHTML = '🔄';
    button.disabled = true;
    button.style.opacity = '0.5';
    
    try {
        // Get high-accuracy location
        const freshLocation = await getHighAccuracyLocation();
        if (freshLocation) {
            currentUserLocation = freshLocation;
            lastLocationUpdate = Date.now();
            
            // Save to Supabase with accuracy
            await saveUserLocationToSupabase(
                freshLocation.latitude, 
                freshLocation.longitude, 
                freshLocation.accuracy
            );
            
            // Update courses with new distances
            coursesData.forEach(course => {
                if (course.coordinates) {
                    try {
                        const [lat, lon] = course.coordinates.split(',').map(Number);
                        course.distance = calculateDistance(
                            freshLocation.latitude, 
                            freshLocation.longitude, 
                            lat, 
                            lon
                        );
                    } catch (error) {
                        console.warn(`Invalid coordinates for course ${course.name}`);
                    }
                }
            });
            
            // Re-sort and display courses
            sortCourses(courseSortBy);
            displayCourses();
            
            // Brief success indicator
            button.innerHTML = '✓';
            button.style.backgroundColor = '#dcfce7';
            button.style.color = '#166534';
            
            setTimeout(() => {
                button.innerHTML = originalText;
                button.style.backgroundColor = '';
                button.style.color = '';
            }, 1500);
        } else {
            throw new Error('Could not get location');
        }
    } catch (error) {
        console.error('Error refreshing location from button:', error);
        // Show error state
        button.innerHTML = '✗';
        button.style.backgroundColor = '#fecaca';
        button.style.color = '#dc2626';
        
        setTimeout(() => {
            button.innerHTML = originalText;
            button.style.backgroundColor = '';
            button.style.color = '';
        }, 1500);
    } finally {
        button.disabled = false;
        button.style.opacity = '1';
    }
}

// Function to load and display detailed hole-by-hole scorecard
async function loadRoundScorecard(roundId, itemId) {
    const content = document.getElementById(`round-content-${itemId}`);
    if (!content) return;
    
    // Show loading state
    content.innerHTML = `
        <div class="p-4 text-center">
            <div class="text-gray-500">Loading scorecard...</div>
        </div>
    `;
    
    try {
        const { data: round, error } = await supabase
            .from('rounds')
            .select('*')
            .eq('id', roundId)
            .single();

        if (error || !round) {
            content.innerHTML = `
                <div class="p-4 text-center text-red-500">
                    Error loading scorecard details
                </div>
            `;
            return;
        }

        // Find course to get par info
        const course = coursesData.find(c => c.id == round.course_id);
        
        if (!course) {
            content.innerHTML = `
                <div class="p-4 text-center text-red-500">
                    Course data not found
                </div>
            `;
            return;
        }
        
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

        // Build the detailed scorecard HTML
        let scorecardHTML = `
            <div class="p-4 bg-gray-50">
                <div class="flex items-center justify-between mb-4">
                    <h5 class="font-semibold text-gray-800 text-sm">Hole-by-hole scorecard:</h5>
                    <div class="flex items-center">
                        <span class="text-xs text-gray-600 mr-2">±Par</span>
                        <label class="switch">
                            <input type="checkbox" ${showScoreDifference ? '' : 'checked'} onchange="toggleScoreDisplayAndRefresh(this, '${roundId}', '${itemId}')">
                            <span class="slider round"></span>
                        </label>
                        <span class="text-xs text-gray-600 ml-2">Total</span>
                    </div>
                </div>
                
                <div class="overflow-x-auto mb-4 border border-gray-300 rounded-lg">
                    <table class="min-w-full text-xs border-collapse bg-white">
                        <thead>
                            <tr class="bg-gray-200">
                                <th class="border border-gray-300 p-2 text-center font-semibold sticky left-0 bg-gray-200 z-10">Hole</th>
        `;

        // Add player headers (abbreviated for mobile)
        displayPlayers.forEach(player => {
            const shortName = player.length > 8 ? player.substring(0, 8) + '.' : player;
            scorecardHTML += `<th class="border border-gray-300 p-2 text-center font-semibold min-w-[50px]" title="${player}">${shortName}</th>`;
        });
        scorecardHTML += `<th class="border border-gray-300 p-2 text-center font-semibold bg-blue-100">Par</th></tr></thead><tbody>`;

        // Add hole rows
        for (let i = 0; i < course.holes.length; i++) {
            const holeClass = i % 2 === 0 ? 'bg-white' : 'bg-gray-50';
            const holePar = course.holes[i];
            scorecardHTML += `<tr class="${holeClass} hover:bg-blue-50"><td class="border border-gray-300 p-2 text-center font-semibold sticky left-0 ${holeClass} z-10">${i + 1}</td>`;
            
            if (useNewFormat) {
                // Registered players
                round.player_ids.forEach(playerId => {
                    const score = round.scores[playerId]?.[i] || '-';
                    let displayScore, cellClass;
                    
                    if (score !== '-' && score > 0) {
                        const scoreDiff = score - holePar;
                        if (showScoreDifference) {
                            displayScore = scoreDiff === 0 ? 'E' : scoreDiff > 0 ? `+${scoreDiff}` : `${scoreDiff}`;
                        } else {
                            displayScore = score;
                        }
                        cellClass = scoreDiff <= -2 ? 'text-emerald-600 font-bold bg-emerald-50' :     // Eagle or better - vibrant emerald with background
                                    scoreDiff == -1 ? 'text-green-600 font-bold bg-green-50' :         // Birdie - bright green with background  
                                    scoreDiff == 0  ? 'text-blue-600 font-bold' :                      // Par - clean blue (no background needed)
                                    scoreDiff == 1  ? 'text-amber-600 font-bold' :                     // Bogey - amber (warmer than yellow)
                                    scoreDiff == 2  ? 'text-orange-600 font-bold bg-orange-50' :       // Double bogey - stronger orange with background
                                    scoreDiff >= 3  ? 'text-red-600 font-bold bg-red-50' :             // Triple+ - red with background emphasis
                                    'text-gray-800';
                    } else {
                        displayScore = '-';
                        cellClass = 'text-gray-400';
                    }
                    
                    scorecardHTML += `<td class="border border-gray-300 p-2 text-center ${cellClass}">${displayScore}</td>`;
                });
                
                // Guest players
                if (round.guest_players && round.guest_players.length > 0) {
                    round.guest_players.forEach(guestName => {
                        const guestId = `guest_${guestName.replace(/\s+/g, '_').toLowerCase()}`;
                        const score = round.scores[guestId]?.[i] || '-';
                        let displayScore, cellClass;
                        
                        if (score !== '-' && score > 0) {
                            const scoreDiff = score - holePar;
                            if (showScoreDifference) {
                                displayScore = scoreDiff === 0 ? 'E' : scoreDiff > 0 ? `+${scoreDiff}` : `${scoreDiff}`;
                            } else {
                                displayScore = score;
                            }
                            cellClass = scoreDiff < 0 ? 'text-green-600 font-bold' : 
                                       scoreDiff > 0 ? 'text-red-600 font-bold' : 
                                       'text-gray-800';
                        } else {
                            displayScore = '-';
                            cellClass = 'text-gray-400';
                        }
                        
                        scorecardHTML += `<td class="border border-gray-300 p-2 text-center ${cellClass}">${displayScore}</td>`;
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
                    
                    let displayScore, cellClass;
                    
                    if (score !== '-' && score > 0) {
                        const scoreDiff = score - holePar;
                        if (showScoreDifference) {
                            displayScore = scoreDiff === 0 ? 'E' : scoreDiff > 0 ? `+${scoreDiff}` : `${scoreDiff}`;
                        } else {
                            displayScore = score;
                        }
                        cellClass = scoreDiff < 0 ? 'text-green-600 font-bold' : 
                                   scoreDiff > 0 ? 'text-red-600 font-bold' : 
                                   'text-gray-800';
                    } else {
                        displayScore = '-';
                        cellClass = 'text-gray-400';
                    }
                    
                    scorecardHTML += `<td class="border border-gray-300 p-2 text-center ${cellClass}">${displayScore}</td>`;
                });
            }
            
            scorecardHTML += `<td class="border border-gray-300 p-2 text-center font-bold text-blue-600 bg-blue-50">${course.holes[i]}</td></tr>`;
        }

        // Totals row - Replace the existing totals calculation with this:
        scorecardHTML += '<tr class="bg-gray-300 font-bold border-t-2 border-gray-400"><td class="border border-gray-300 p-2 text-center sticky left-0 bg-gray-300 z-10">Total</td>';

        // Calculate totals only for played holes
        if (useNewFormat) {
            // Totals for registered players
            round.player_ids.forEach(playerId => {
                const username = round.player_usernames[playerId];
                let playerTotal = 0;
                let playerParTotal = 0;
                
                // Only count holes that were actually played (score > 0)
                for (let i = 0; i < course.holes.length; i++) {
                    const score = round.scores[playerId]?.[i] || 0;
                    if (score > 0) {
                        playerTotal += score;
                        playerParTotal += course.holes[i];
                    }
                }
                
                let displayTotal, cellClass;
                if (playerTotal > 0) {
                    const totalDiff = playerTotal - playerParTotal;
                    if (showScoreDifference) {
                        displayTotal = totalDiff === 0 ? 'E' : totalDiff > 0 ? `+${totalDiff}` : `${totalDiff}`;
                    } else {
                        displayTotal = playerTotal;
                    }
                    cellClass = totalDiff < 0 ? 'text-green-600' : 
                            totalDiff > 0 ? 'text-red-600' : 
                            'text-gray-800';
                } else {
                    displayTotal = '-';
                    cellClass = 'text-gray-400';
                }
                
                scorecardHTML += `<td class="border border-gray-300 p-2 text-center ${cellClass}">${displayTotal}</td>`;
            });
            
            // Totals for guest players
            if (round.guest_players && round.guest_players.length > 0) {
                round.guest_players.forEach(guestName => {
                    const guestId = `guest_${guestName.replace(/\s+/g, '_').toLowerCase()}`;
                    let playerTotal = 0;
                    let playerParTotal = 0;
                    
                    // Only count holes that were actually played (score > 0)
                    for (let i = 0; i < course.holes.length; i++) {
                        const score = round.scores[guestId]?.[i] || 0;
                        if (score > 0) {
                            playerTotal += score;
                            playerParTotal += course.holes[i];
                        }
                    }
                    
                    let displayTotal, cellClass;
                    if (playerTotal > 0) {
                        const totalDiff = playerTotal - playerParTotal;
                        if (showScoreDifference) {
                            displayTotal = totalDiff === 0 ? 'E' : totalDiff > 0 ? `+${totalDiff}` : `${totalDiff}`;
                        } else {
                            displayTotal = playerTotal;
                        }
                        cellClass = totalDiff < 0 ? 'text-green-600' : 
                                totalDiff > 0 ? 'text-red-600' : 
                                'text-gray-800';
                    } else {
                        displayTotal = '-';
                        cellClass = 'text-gray-400';
                    }
                    
                    scorecardHTML += `<td class="border border-gray-300 p-2 text-center ${cellClass}">${displayTotal}</td>`;
                });
            }
        } else {
            // Old format totals
            displayPlayers.forEach(player => {
                let playerTotal = 0;
                let playerParTotal = 0;
                
                // Only count holes that were actually played (score > 0)
                for (let i = 0; i < course.holes.length; i++) {
                    let score = 0;
                    if (player.includes('(Guest)')) {
                        const baseName = player.replace(' (Guest)', '');
                        const guestId = `guest_${baseName.replace(/\s+/g, '_').toLowerCase()}`;
                        score = round.scores[guestId]?.[i] || 0;
                    } else {
                        score = round.scores[player]?.[i] || 0;
                    }
                    
                    if (score > 0) {
                        playerTotal += score;
                        playerParTotal += course.holes[i];
                    }
                }
                
                let displayTotal, cellClass;
                if (playerTotal > 0) {
                    const totalDiff = playerTotal - playerParTotal;
                    if (showScoreDifference) {
                        displayTotal = totalDiff === 0 ? 'E' : totalDiff > 0 ? `+${totalDiff}` : `${totalDiff}`;
                    } else {
                        displayTotal = playerTotal;
                    }
                    cellClass = totalDiff < 0 ? 'text-green-600' : 
                            totalDiff > 0 ? 'text-red-600' : 
                            'text-gray-800';
                } else {
                    displayTotal = '-';
                    cellClass = 'text-gray-400';
                }
                
                scorecardHTML += `<td class="border border-gray-300 p-2 text-center ${cellClass}">${displayTotal}</td>`;
            });
        }

        // Show "Played Par" instead of total course par
        let totalPlayedPar = 0;
        for (let i = 0; i < course.holes.length; i++) {
            // Check if ANY player played this hole
            let holeWasPlayed = false;
            if (useNewFormat) {
                round.player_ids.forEach(playerId => {
                    if (round.scores[playerId]?.[i] > 0) holeWasPlayed = true;
                });
                if (round.guest_players) {
                    round.guest_players.forEach(guestName => {
                        const guestId = `guest_${guestName.replace(/\s+/g, '_').toLowerCase()}`;
                        if (round.scores[guestId]?.[i] > 0) holeWasPlayed = true;
                    });
                }
            } else {
                displayPlayers.forEach(player => {
                    let score = 0;
                    if (player.includes('(Guest)')) {
                        const baseName = player.replace(' (Guest)', '');
                        const guestId = `guest_${baseName.replace(/\s+/g, '_').toLowerCase()}`;
                        score = round.scores[guestId]?.[i] || 0;
                    } else {
                        score = round.scores[player]?.[i] || 0;
                    }
                    if (score > 0) holeWasPlayed = true;
                });
            }
            
            if (holeWasPlayed) {
                totalPlayedPar += course.holes[i];
            }
        }

        scorecardHTML += `<td class="border border-gray-300 p-2 text-center font-bold text-blue-600 bg-blue-100">${totalPlayedPar}</td></tr>`;
        scorecardHTML += '</tbody></table></div>';

        // Action buttons with better spacing
        scorecardHTML += `
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4 pt-3 border-t border-gray-300">
                    <button onclick="event.stopPropagation(); copyRoundToText('${round.id}')" 
                            class="w-full bg-green-600 hover:bg-green-700 text-white text-sm py-2 px-4 rounded-lg font-medium transition-colors duration-200">
                        📋 Copy Round Data
                    </button>
                    <button onclick="event.stopPropagation(); deleteRound('${round.id}')" 
                            class="w-full bg-red-600 hover:bg-red-700 text-white text-sm py-2 px-4 rounded-lg font-medium transition-colors duration-200">
                        🗑️ Delete Round
                    </button>
                </div>
            </div>
        `;

        content.innerHTML = scorecardHTML;

    } catch (error) {
        console.error('Error loading round scorecard:', error);
        content.innerHTML = `
            <div class="p-4 text-center text-red-500">
                Failed to load scorecard details
            </div>
        `;
    }
}

// Function to toggle score display and refresh just this scorecard
function toggleScoreDisplayAndRefresh(checkbox, roundId, itemId) {
    showScoreDifference = !checkbox.checked;
    
    // Update all other switch inputs to stay in sync (now using .switch class instead of .score-toggle)
    document.querySelectorAll('.switch input').forEach(input => {
        input.checked = !showScoreDifference;
    });
    
    // Update any remaining score-toggle elements if they exist
    document.querySelectorAll('.score-toggle input').forEach(input => {
        input.checked = !showScoreDifference;
    });
    document.querySelectorAll('.score-toggle-label').forEach(label => {
        label.textContent = showScoreDifference ? '±Par' : 'Total';
    });
    
    // Instead of reloading the entire scorecard, just update the current one
    updateScorecardDisplay(roundId, itemId);
}

// Function to update just the scorecard display without reloading content
async function updateScorecardDisplay(roundId, itemId) {
    try {
        const { data: round, error } = await supabase
            .from('rounds')
            .select('*')
            .eq('id', roundId)
            .single();

        if (error || !round) {
            console.error('Error loading round for display update:', error);
            return;
        }

        // Find course to get par info
        const course = coursesData.find(c => c.id == round.course_id);
        if (!course) {
            console.error('Course not found for round');
            return;
        }

        const useNewFormat = round.player_ids && round.player_usernames && round.scores;
        let displayPlayers = [];
        
        if (useNewFormat) {
            displayPlayers = round.player_ids.map(id => round.player_usernames[id] || `User_${id.substring(0, 8)}`);
            if (round.guest_players && round.guest_players.length > 0) {
                displayPlayers = [...displayPlayers, ...round.guest_players.map(name => `${name} (Guest)`)];
            }
        } else {
            displayPlayers = round.players;
        }

        // Update hole scores in the table
        for (let holeIndex = 0; holeIndex < course.holes.length; holeIndex++) {
            const holePar = course.holes[holeIndex];
            
            displayPlayers.forEach((player, playerIndex) => {
                let score;
                let playerId;
                
                if (useNewFormat) {
                    if (playerIndex < round.player_ids.length) {
                        // Registered player
                        playerId = round.player_ids[playerIndex];
                        score = round.scores[playerId]?.[holeIndex] || '-';
                    } else {
                        // Guest player
                        const guestIndex = playerIndex - round.player_ids.length;
                        const guestName = round.guest_players[guestIndex];
                        const guestId = `guest_${guestName.replace(/\s+/g, '_').toLowerCase()}`;
                        score = round.scores[guestId]?.[holeIndex] || '-';
                    }
                } else {
                    if (player.includes('(Guest)')) {
                        const baseName = player.replace(' (Guest)', '');
                        const guestId = `guest_${baseName.replace(/\s+/g, '_').toLowerCase()}`;
                        score = round.scores[guestId]?.[holeIndex] || '-';
                    } else {
                        score = round.scores[player]?.[holeIndex] || '-';
                    }
                }

                // Find the cell and update it
                const table = document.querySelector(`#round-content-${itemId} table`);
                if (table) {
                    const row = table.rows[holeIndex + 1]; // +1 to skip header
                    if (row) {
                        const cell = row.cells[playerIndex + 1]; // +1 to skip hole number column
                        if (cell && score !== '-' && score > 0) {
                            const scoreDiff = score - holePar;
                            let displayScore, cellClass;
                            
                            if (showScoreDifference) {
                                displayScore = scoreDiff === 0 ? 'E' : scoreDiff > 0 ? `+${scoreDiff}` : `${scoreDiff}`;
                            } else {
                                displayScore = score;
                            }
                            
                            cellClass = scoreDiff <= -2 ? 'text-emerald-600 font-bold bg-emerald-50' :
                                       scoreDiff == -1 ? 'text-green-600 font-bold bg-green-50' :
                                       scoreDiff == 0  ? 'text-blue-600 font-bold' :
                                       scoreDiff == 1  ? 'text-amber-600 font-bold' :
                                       scoreDiff == 2  ? 'text-orange-600 font-bold bg-orange-50' :
                                       scoreDiff >= 3  ? 'text-red-600 font-bold bg-red-50' :
                                       'text-gray-800';
                            
                            // Update cell content and styling
                            cell.textContent = displayScore;
                            cell.className = `border border-gray-300 p-2 text-center ${cellClass}`;
                        }
                    }
                }
            });
        }

        // Update totals row with PLAYED PAR calculation
        const table = document.querySelector(`#round-content-${itemId} table`);
        if (table) {
            const totalsRow = table.rows[table.rows.length - 1];
            
            displayPlayers.forEach((player, playerIndex) => {
                // Calculate this player's total and played par
                let playerTotal = 0;
                let playerPlayedPar = 0;
                
                if (useNewFormat) {
                    if (playerIndex < round.player_ids.length) {
                        const playerId = round.player_ids[playerIndex];
                        for (let i = 0; i < course.holes.length; i++) {
                            const score = round.scores[playerId]?.[i] || 0;
                            if (score > 0) {
                                playerTotal += score;
                                playerPlayedPar += course.holes[i];
                            }
                        }
                    } else {
                        const guestIndex = playerIndex - round.player_ids.length;
                        const guestName = round.guest_players[guestIndex];
                        const guestId = `guest_${guestName.replace(/\s+/g, '_').toLowerCase()}`;
                        for (let i = 0; i < course.holes.length; i++) {
                            const score = round.scores[guestId]?.[i] || 0;
                            if (score > 0) {
                                playerTotal += score;
                                playerPlayedPar += course.holes[i];
                            }
                        }
                    }
                } else {
                    for (let i = 0; i < course.holes.length; i++) {
                        let score = 0;
                        if (player.includes('(Guest)')) {
                            const baseName = player.replace(' (Guest)', '');
                            const guestId = `guest_${baseName.replace(/\s+/g, '_').toLowerCase()}`;
                            score = round.scores[guestId]?.[i] || 0;
                        } else {
                            score = round.scores[player]?.[i] || 0;
                        }
                        
                        if (score > 0) {
                            playerTotal += score;
                            playerPlayedPar += course.holes[i];
                        }
                    }
                }
                
                const cell = totalsRow.cells[playerIndex + 1]; // +1 to skip hole number column
                if (cell && playerTotal > 0) {
                    const totalDiff = playerTotal - playerPlayedPar; // Use played par here!
                    let displayTotal, cellClass;
                    
                    if (showScoreDifference) {
                        displayTotal = totalDiff === 0 ? 'E' : totalDiff > 0 ? `+${totalDiff}` : `${totalDiff}`;
                    } else {
                        displayTotal = playerTotal;
                    }
                    
                    cellClass = totalDiff < 0 ? 'text-green-600' : 
                               totalDiff > 0 ? 'text-red-600' : 
                               'text-gray-800';
                    
                    cell.textContent = displayTotal;
                    cell.className = `border border-gray-300 p-2 text-center ${cellClass}`;
                } else if (cell) {
                    cell.textContent = '-';
                    cell.className = 'border border-gray-300 p-2 text-center text-gray-400';
                }
            });
        }

    } catch (error) {
        console.error('Error updating scorecard display:', error);
    }
}

// Helper function to determine difficulty
function getDifficultyLevel(name, par, holes, avgDistance) {
    const avgPar = par / holes;
    const namePattern = name.toLowerCase();
    
    let difficultyScore = 0;
    
    // Distance-based scoring (primary factor) - independent of hole count
    if (avgDistance < 75) {
        difficultyScore += 1; // Easy
    } else if (avgDistance >= 75 && avgDistance <= 100) {
        difficultyScore += 2; // Medium
    } else if (avgDistance > 100) {
        difficultyScore += 3; // Hard
    }
    
    // Par-based scoring (secondary factor) - normalized per hole
    if (avgPar < 3.2) {
        difficultyScore += 0.5; // Easier
    } else if (avgPar > 3.6) {
        difficultyScore += 1; // Harder
    }
    
    // Name-based overrides (can bump up or down)
    if (namePattern.includes('lätt') || namePattern.includes('easy') || namePattern.includes('nybörjare')) {
        difficultyScore -= 0.5;
    } else if (namePattern.includes('svår') || namePattern.includes('hard') || namePattern.includes('championship') || 
               namePattern.includes('pro') || namePattern.includes('mäster')) {
        difficultyScore += 1;
    } else if (namePattern.includes('medel') || namePattern.includes('medium')) {
        difficultyScore = 2; // Force medium if explicitly stated
    }
    
    // Adjust thresholds to be more lenient for courses just over 100m average
    if (difficultyScore <= 1.5) {
        return { class: 'bg-green-100 text-green-700', text: 'Easy', emoji: '🟢' };
    } else if (difficultyScore >= 4) { // Raised threshold from 3.5 to 4
        return { class: 'bg-red-100 text-red-700', text: 'Hard', emoji: '🔴' };
    } else {
        return { class: 'bg-yellow-300 text-yellow-700', text: 'Medium', emoji: '🟡' };
    }
}

// Helper function to get course emoji - Enhanced for Swedish courses
function getCourseEmoji(name) {
    const namePattern = name.toLowerCase();
    
    // Specific Uppsala area courses
    if (namePattern.includes('domarringen')) return 'crown'; // "Domare" = Judge, royal theme
    if (namePattern.includes('rosendal')) return 'deceased'; // Rose valley
    if (namePattern.includes('röbo')) return 'water'; // Water/stream theme
    if (namePattern.includes('ultuna')) return 'school'; // University/academic area
    if (namePattern.includes('gamla uppsala')) return 'shield'; // Ancient Uppsala, Viking theme
    if (namePattern.includes('uppsala')) return 'account_balance'; // Historic university city
    if (namePattern.includes('gimo')) return 'agriculture'; // Already defined
    if (namePattern.includes('malmaskolan')) return 'school'; // "Skolan" = school
    if (namePattern.includes('gipen')) return 'landscape'; // Natural area name
    
    // Default disc golf icon
    return 'sports'; // Generic sports icon as default
}

// Calculate distance between two coordinates using Haversine formula
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distance = R * c; // Distance in kilometers
    return distance;
}

// Add comprehensive location diagnostics
async function diagnoseLocationIssues() {
    console.log('🔍 Starting location diagnostics...');
    
    // Check if we're in a secure context (HTTPS required for high accuracy)
    console.log('Secure context (HTTPS):', window.isSecureContext);
    
    // Check permissions
    if ('permissions' in navigator) {
        try {
            const permission = await navigator.permissions.query({name: 'geolocation'});
            console.log('Geolocation permission:', permission.state);
        } catch (error) {
            console.log('Could not check geolocation permission');
        }
    }
    
    // Test different accuracy settings
    const settings = [
        { name: 'High Accuracy + Long Timeout', options: { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 } },
        { name: 'Network Only', options: { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 } },
        { name: 'Cached', options: { enableHighAccuracy: true, timeout: 5000, maximumAge: 300000 } }
    ];
    
    for (const setting of settings) {
        console.log(`\n📍 Testing: ${setting.name}`);
        try {
            const position = await new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, setting.options);
            });
            
            console.log(`✅ ${setting.name}:`, {
                lat: position.coords.latitude,
                lon: position.coords.longitude,
                accuracy: `±${position.coords.accuracy}m`,
                altitude: position.coords.altitude,
                altitudeAccuracy: position.coords.altitudeAccuracy,
                heading: position.coords.heading,
                speed: position.coords.speed,
                timestamp: new Date(position.timestamp).toISOString()
            });
        } catch (error) {
            console.log(`❌ ${setting.name} failed:`, error.message);
        }
    }
}

// Get user's current position
async function getUserLocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            console.log('Geolocation is not supported by this browser');
            resolve(null);
            return;
        }
        
        // Check if we're on HTTPS (required for high accuracy GPS)
        if (!window.isSecureContext) {
            console.warn('⚠️ Not in secure context (HTTPS required for high accuracy GPS)');
        }
        
        navigator.geolocation.getCurrentPosition(
            (position) => {
                console.log('Location permission granted');
                console.log(`GPS Accuracy: ±${position.coords.accuracy}m`);
                
                // Log additional GPS details for debugging
                console.log('GPS Details:', {
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                    accuracy: position.coords.accuracy,
                    altitude: position.coords.altitude,
                    altitudeAccuracy: position.coords.altitudeAccuracy,
                    heading: position.coords.heading,
                    speed: position.coords.speed,
                    timestamp: new Date(position.timestamp).toISOString(),
                    isHighAccuracy: position.coords.accuracy < 100 ? 'YES' : 'NO'
                });
                
                resolve({
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                    accuracy: position.coords.accuracy,
                    timestamp: new Date(position.timestamp),
                    altitude: position.coords.altitude,
                    speed: position.coords.speed,
                    heading: position.coords.heading
                });
            },
            (error) => {
                console.log('Location error:', error.message, 'Code:', error.code);
                
                // Provide specific error messages
                switch(error.code) {
                    case error.PERMISSION_DENIED:
                        console.log('❌ User denied geolocation permission');
                        break;
                    case error.POSITION_UNAVAILABLE:
                        console.log('❌ Location information unavailable');
                        break;
                    case error.TIMEOUT:
                        console.log('❌ Location request timed out');
                        break;
                    default:
                        console.log('❌ Unknown location error');
                        break;
                }
                resolve(null);
            },
            {
                enableHighAccuracy: true,
                timeout: 30000,              // Increased to 30 seconds
                maximumAge: 0               // Always get fresh location
            }
        );
    });
}

async function runLocationDiagnostics() {
    const button = event.target;
    const originalText = button.innerHTML;
    button.innerHTML = '🔬 Running diagnostics...';
    button.disabled = true;
    
    try {
        // Open console for user to see results
        Swal.fire({
            title: 'GPS Diagnostics Running',
            text: 'Check the browser console (F12) for detailed results',
            icon: 'info',
            timer: 3000,
            showConfirmButton: false
        });
        
        await diagnoseLocationIssues();
        
        // Show summary
        Swal.fire({
            title: 'Diagnostics Complete',
            html: `
                <div style="text-align: left; font-size: 14px;">
                    <p><strong>Check the console for full results!</strong></p>
                    <br>
                    <p><strong>Quick fixes to try:</strong></p>
                    <ul style="padding-left: 20px;">
                        <li>Ensure you're on WiFi (not mobile data)</li>
                        <li>Go outside or near a window</li>
                        <li>Wait 1-2 minutes for GPS to lock</li>
                        <li>Clear browser location permission and re-grant</li>
                        <li>Use Chrome/Firefox for best GPS support</li>
                    </ul>
                </div>
            `,
            icon: 'info',
            confirmButtonText: 'Got it!'
        });
        
    } catch (error) {
        console.error('Diagnostics failed:', error);
        Swal.fire({
            title: 'Diagnostics Failed',
            text: 'Could not run location diagnostics',
            icon: 'error'
        });
    } finally {
        button.innerHTML = originalText;
        button.disabled = false;
    }
}

// Get multiple location readings and use the most accurate one
async function getHighAccuracyLocation(maxAttempts = 3) {
    const locations = [];
    
    for (let i = 0; i < maxAttempts; i++) {
        try {
            console.log(`Getting location reading ${i + 1}/${maxAttempts}...`);
            const location = await getUserLocation();
            
            if (location && location.accuracy) {
                locations.push(location);
                console.log(`Reading ${i + 1}: Accuracy ±${location.accuracy}m`);
                
                // If we get a very accurate reading (< 20m), use it immediately
                if (location.accuracy < 20) {
                    console.log('High accuracy location found, using immediately');
                    return location;
                }
            }
            
            // Wait 2 seconds between readings to allow GPS to stabilize
            if (i < maxAttempts - 1) {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        } catch (error) {
            console.error(`Location reading ${i + 1} failed:`, error);
        }
    }
    
    if (locations.length === 0) {
        console.log('No valid location readings obtained');
        return null;
    }
    
    // Return the most accurate reading
    const bestLocation = locations.reduce((best, current) => 
        current.accuracy < best.accuracy ? current : best
    );
    
    console.log(`Using best location with accuracy ±${bestLocation.accuracy}m`);
    return bestLocation;
}

// Check if new location is significantly different from cached location
function isLocationSignificantlyDifferent(oldLocation, newLocation, thresholdMeters = 50) {
    if (!oldLocation || !newLocation) return true;
    
    const distance = calculateDistance(
        oldLocation.latitude, 
        oldLocation.longitude,
        newLocation.latitude, 
        newLocation.longitude
    ) * 1000; // Convert to meters
    
    console.log(`Location difference: ${Math.round(distance)}m`);
    return distance > thresholdMeters;
}

// Enhanced location update with accuracy checking
async function updateUserLocationSmart() {
    try {
        // Check if we have a recent cached location
        const cachedLocation = await getUserLocationFromSupabase();
        
        // Get new high-accuracy location
        const newLocation = await getHighAccuracyLocation();
        
        if (!newLocation) {
            console.log('Could not get accurate location');
            return;
        }
        
        // Only update if location has changed significantly or accuracy improved
        let shouldUpdate = false;
        
        if (!cachedLocation) {
            console.log('No cached location, saving new location');
            shouldUpdate = true;
        } else if (newLocation.accuracy < cachedLocation.accuracy * 0.8) {
            console.log('New location is significantly more accurate');
            shouldUpdate = true;
        } else if (isLocationSignificantlyDifferent(cachedLocation, newLocation, 50)) {
            console.log('Location has changed significantly');
            shouldUpdate = true;
        } else {
            console.log('Location unchanged, keeping cached version');
            return;
        }
        
        if (shouldUpdate) {
            currentUserLocation = newLocation;
            lastLocationUpdate = Date.now();
            
            // Save to Supabase
            await saveUserLocationToSupabase(newLocation.latitude, newLocation.longitude);
            
            // Update course distances
            coursesData.forEach(course => {
                if (course.coordinates) {
                    try {
                        const [lat, lon] = course.coordinates.split(',').map(Number);
                        course.distance = calculateDistance(
                            newLocation.latitude, 
                            newLocation.longitude, 
                            lat, 
                            lon
                        );
                    } catch (error) {
                        console.warn(`Invalid coordinates for course ${course.name}`);
                    }
                }
            });
            
            // Re-sort and display courses if user is on new-round section
            const newRoundSection = document.getElementById('new-round');
            if (newRoundSection && !newRoundSection.classList.contains('hidden')) {
                sortCourses(courseSortBy);
                displayCourses();
            }
        }
    } catch (error) {
        console.error('Error updating location:', error);
    }
}

// Format distance for display
function formatDistance(distance) {
    if (distance < 1) {
        return `${Math.round(distance * 1000)}m`;
    } else if (distance < 10) {
        return `${distance.toFixed(1)}km`;
    } else {
        return `${Math.round(distance)}km`;
    }
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
            .select('friend_id, user_id, is_favorite')
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
                    <p>Add friends by their username to track their progress and add them to your rounds!</p>
                </div>
            `;
            return;
        }

        const friendData = friendships.map(f => ({
            id: f.user_id === user.id ? f.friend_id : f.user_id,
            // Only use is_favorite if current user is the one who set it (user_id matches)
            is_favorite: f.user_id === user.id ? (f.is_favorite || false) : false
        }));

        // Get friend IDs
        const friendIds = friendData.map(f => f.id);

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

        
        // After getting friendProfiles, sort by favorite status
        friendProfiles.sort((a, b) => {
            const aFavorite = friendData.find(fd => fd.id === a.id)?.is_favorite || false;
            const bFavorite = friendData.find(fd => fd.id === b.id)?.is_favorite || false;
            
            // Favorites first
            if (aFavorite && !bFavorite) return -1;
            if (!aFavorite && bFavorite) return 1;
            
            // Then alphabetically by username
            return a.username.localeCompare(b.username);
        });

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

            // Get favorite status
            const friendDataItem = friendData.find(fd => fd.id === friend.id);
            const isFavorite = friendDataItem?.is_favorite || false;
            friend.is_favorite = isFavorite; // Add to friend object for showFriendDetails

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
                            <div class="flex items-center gap-1">
                                <h4 class="font-semibold text-gray-900 text-sm truncate">${friend.username}</h4>
                                <button onclick="event.stopPropagation(); toggleFriendFavorite('${friend.id}', '${friend.username}')" 
                                        class="hover:scale-110 transition-transform duration-200 flex-shrink-0">
                                    <span class="material-symbols-rounded ${isFavorite ? 'text-yellow-400 star-filled' : 'text-gray-400 star-outlined'}">
                                        star
                                    </span>
                                </button>
                            </div>
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

        // Calculate detailed stats like in updateProgress
        let totalRounds = 0;
        let totalThrows = 0;
        let scoresToPar = [];
        let validRounds = [];

        rounds.forEach(round => {
            if (round.final_scores && friend.username && round.final_scores[friend.username] != null) {
                const score = round.final_scores[friend.username];
                
                // Find course to get par
                const course = coursesData.find(c => c.id == round.course_id);
                const par = course ? course.holes.reduce((a, b) => a + b, 0) : 0;
                
                if (par > 0 && score > 0) {
                    totalRounds++;
                    totalThrows += score;
                    scoresToPar.push(score - par);
                    validRounds.push({ score, par, scoreToPar: score - par });
                }
            }
        });

        // Calculate stats
        const avgScore = scoresToPar.length > 0 ? 
            (scoresToPar.reduce((a, b) => a + b, 0) / scoresToPar.length).toFixed(1) : '-';
        const bestScore = validRounds.length > 0 ? 
            Math.min(...scoresToPar) : '-';

        // Format displays
        const avgScoreDisplay = avgScore === '-' ? '-' : 
            (avgScore == 0 ? 'E' : (avgScore > 0 ? `+${avgScore}` : avgScore));
        const bestScoreDisplay = bestScore === '-' ? '-' : 
            (bestScore == 0 ? 'E' : (bestScore > 0 ? `+${bestScore}` : bestScore));

        const recentRounds = rounds.slice(0, 3);

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
                            <div class="flex items-center gap-2">
                                <h3 class="text-xl font-bold text-gray-900">${friend.username}</h3>
                                <button onclick="event.stopPropagation(); toggleFriendFavorite('${friend.id}', '${friend.username}')" 
                                        class="text-2xl hover:scale-110 transition-transform duration-200" 
                                        id="favorite-star-${friend.id}">
                                    ${friend.is_favorite ? '⭐' : '☆'}
                                </button>
                            </div>
                            <p class="text-gray-600 text-sm">${friend.bio || 'No bio set'}</p>
                        </div>
                    </div>
                    
                    <div class="grid grid-cols-4 gap-3 mb-6">
                        <div class="text-center p-3 bg-indigo-50 rounded-lg">
                            <div class="text-[10px] font-bold text-indigo-600">${totalRounds}</div>
                            <div class="text-[10px] text-gray-600 leading-tight">Total<br>Rounds</div>
                        </div>
                        <div class="text-center p-3 bg-orange-50 rounded-lg">
                            <div class="text-[10px] font-bold text-orange-600">${totalThrows.toLocaleString()}</div>
                            <div class="text-[10px] text-gray-600 leading-tight">Total<br>Throws</div>
                        </div>
                        <div class="text-center p-3 bg-green-50 rounded-lg">
                            <div class="text-[10px] font-bold text-green-600">${avgScoreDisplay}</div>
                            <div class="text-[10px] text-gray-600 leading-tight">Average<br>Score</div>
                        </div>
                        <div class="text-center p-3 bg-purple-50 rounded-lg">
                            <div class="text-[10px] font-bold text-purple-600">${bestScoreDisplay}</div>
                            <div class="text-[10px] text-gray-600 leading-tight">Best<br>Round</div>
                        </div>
                    </div>
                                        
                    ${recentRoundsHTML}
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

async function toggleFriendFavorite(friendId, friendUsername) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    try {
        // Get current friendship - only where current user is the owner
        const { data: friendship, error: fetchError } = await supabase
            .from('friendships')
            .select('is_favorite')
            .eq('user_id', user.id)
            .eq('friend_id', friendId)
            .single();

        if (fetchError) {
            console.error('Error fetching friendship:', fetchError);
            return;
        }

        const newFavoriteStatus = !friendship.is_favorite;

        // Update only the current user's friendship record (one-way favorite)
        const { error: updateError } = await supabase
            .from('friendships')
            .update({ is_favorite: newFavoriteStatus })
            .eq('user_id', user.id)
            .eq('friend_id', friendId);

        if (updateError) {
            throw updateError;
        }

        // Update the star icon in the modal if it exists
        const starButton = document.getElementById(`favorite-star-${friendId}`);
        if (starButton) {
            starButton.textContent = newFavoriteStatus ? '⭐' : '☆';
        }

        // Reload friends list to update order
        loadFriends();

    } catch (error) {
        console.error('Error toggling favorite:', error);
        Swal.fire({
            icon: "error",
            title: "Error",
            text: "Could not update favorite status",
            timer: 2000,
            showConfirmButton: false
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
                        <div class="flex items-center justify-between w-full">
                            <div class="flex-1 min-w-0">
                                <div class="font-semibold text-gray-800">${profile.username}</div>
                                <div class="text-sm text-gray-600 truncate">${profile.bio || 'No bio'}</div>
                            </div>
                            <div class="ml-3 flex-shrink-0">
                                ${isAlreadyFriend 
                                    ? '<span class="text-green-600 font-semibold text-sm">✓ Friends</span>'
                                    : `<button class="btn bg-indigo-600 hover:bg-indigo-700 text-white text-sm py-2 px-3 rounded-lg font-medium transition-colors duration-200" 
                                            onclick="sendFriendRequest('${profile.id}', '${profile.username}')">
                                        Add Friend
                                    </button>`
                                }
                            </div>
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

function showCanvasConfetti() {
    const canvas = document.createElement('canvas');
    canvas.style.position = 'fixed';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '9999';
    document.body.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const confetti = [];
    const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#ffd93d', '#ff8a80', '#c7ecee'];

    // Create confetti particles
    for (let i = 0; i < 100; i++) {
        confetti.push({
            x: Math.random() * canvas.width,
            y: -10,
            vx: (Math.random() - 0.5) * 4,
            vy: Math.random() * 3 + 2,
            color: colors[Math.floor(Math.random() * colors.length)],
            size: Math.random() * 8 + 4,
            rotation: Math.random() * 360,
            rotationSpeed: (Math.random() - 0.5) * 10
        });
    }

    function updateConfetti() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        for (let i = confetti.length - 1; i >= 0; i--) {
            const particle = confetti[i];
            
            // Update position
            particle.x += particle.vx;
            particle.y += particle.vy;
            particle.rotation += particle.rotationSpeed;
            
            // Add gravity
            particle.vy += 0.1;

            // Draw particle
            ctx.save();
            ctx.translate(particle.x, particle.y);
            ctx.rotate(particle.rotation * Math.PI / 180);
            ctx.fillStyle = particle.color;
            ctx.fillRect(-particle.size/2, -particle.size/2, particle.size, particle.size);
            ctx.restore();

            // Remove particles that are off screen
            if (particle.y > canvas.height + 10) {
                confetti.splice(i, 1);
            }
        }

        if (confetti.length > 0) {
            requestAnimationFrame(updateConfetti);
        } else {
            document.body.removeChild(canvas);
        }
    }

    updateConfetti();
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
    
    // Find and activate the correct button
    const buttons = document.querySelectorAll('.nav-btn');
    buttons.forEach(btn => {
        const buttonText = btn.querySelector('span:last-child')?.textContent?.toLowerCase();
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
    
    if (!courseId) {
        Swal.fire({
            icon: "warning",
            title: "Missing Information",
            text: "Please select a course",
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

    // Start with just the current user
    const playerIds = [user.id];
    const playerIdToUsername = { [user.id]: currentUsername };
    const usernameToPlayerId = { [currentUsername]: user.id };
    const guestPlayers = [];

    console.log('Starting round with player ID:', user.id);
    console.log('Player ID to Username mapping:', playerIdToUsername);

    // Initialize scores object with just the current user
    const initialScores = {
        [user.id]: new Array(course.holes.length).fill(0)
    };

    try {
        // Save the round to Supabase
        const { data: newRound, error } = await supabase
            .from('rounds')
            .insert({
                user_id: user.id,
                course_id: parseInt(courseId),
                course_name: course.name,
                players: [currentUsername], // Only current user initially
                player_ids: playerIds,
                player_usernames: playerIdToUsername,
                guest_players: guestPlayers,
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

        // Set current round with just the current user
        currentRound = {
            id: newRound.id,
            courseId: courseId,
            courseName: course.name,
            playerIds: playerIds,
            registeredPlayerIds: playerIds,
            guestPlayers: guestPlayers,
            playerIdToUsername: playerIdToUsername,
            usernameToPlayerId: usernameToPlayerId,
            scores: initialScores,
            date: new Date().toLocaleDateString()
        };

        console.log('Current round registered players:', playerIds);
        
        // Create scorecard with just the current user
        createScorecard(course, [currentUsername]);
        document.getElementById('current-course').textContent = course.name;
        document.getElementById('scorecard').style.display = 'block';

        // Auto-collapse the new round section to save space
        autoCollapseNewRound();

        Swal.fire({
            title: "Round Started!",
            text: `Started new round at ${course.name}. You can add other players from the Friends section.`,
            icon: "success",
            timer: 3000,
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
        // In updateHoleDisplay, when creating player cards, make sure this line shows "-" for 0 scores:
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
                        class="w-8 h-8 rounded-full border-2 border-indigo-200 object-cover">
                    <div>
                        <div class="font-bold text-gray-800">${player}</div>
                        <div id="score-info-${player}-${holeIndex}" class="text-sm text-gray-600">${scoreText} (${currentScore || par})</div>
                    </div>
                </div>
                <div class="flex items-center gap-2">
                    <button onclick="updateScore('${player}', ${holeIndex}, -1)" 
                            class="w-8 h-8 bg-red-500 hover:bg-red-600 text-white rounded-full text-lg font-bold transition-colors duration-200 flex items-center justify-center">
                        −
                    </button>
                    <div class="w-8 h-8 flex items-center justify-center font-bold text-lg bg-gray-100 rounded-lg border-2 border-gray-300 cursor-pointer hover:bg-gray-200 transition-colors duration-200" 
                        onclick="setScoreToPar('${player}', ${holeIndex})" 
                        title="Click to set to par (${par})">
                        <span id="score-${player}-${holeIndex}">${displayScore}</span>
                    </div>
                    <button onclick="updateScore('${player}', ${holeIndex}, 1)" 
                            class="w-8 h-8 bg-green-500 hover:bg-green-600 text-white rounded-full text-lg font-bold transition-colors duration-200 flex items-center justify-center">
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

async function addGuestPlayerToRound() {
    if (!currentRound) {
        Swal.fire({
            icon: "warning",
            title: "No Active Round",
            text: "Please start a new round first.",
        });
        return;
    }

    const { value: guestName } = await Swal.fire({
        title: 'Add Guest Player',
        input: 'text',
        inputPlaceholder: 'Enter guest player name',
        showCancelButton: true,
        confirmButtonText: 'Add Player',
        confirmButtonColor: '#3b82f6',
        cancelButtonColor: '#6c757d',
        inputValidator: (value) => {
            if (!value || !value.trim()) {
                return 'Please enter a player name';
            }
            if (value.trim().length < 2) {
                return 'Name must be at least 2 characters';
            }
        }
    });

    if (!guestName) return;

    const cleanGuestName = guestName.trim();
    const guestDisplayName = `${cleanGuestName} (Guest)`;
    const guestId = `guest_${cleanGuestName.replace(/\s+/g, '_').toLowerCase()}`;

    // Check if guest already exists
    if (currentRound.usernameToPlayerId[guestDisplayName]) {
        Swal.fire({
            icon: "info",
            title: "Guest Already Added",
            text: `${cleanGuestName} is already in this round.`,
        });
        return;
    }

    try {
        // Add to current round data
        currentRound.playerIds.push(guestId);
        currentRound.guestPlayers.push(cleanGuestName);
        currentRound.playerIdToUsername[guestId] = guestDisplayName;
        currentRound.usernameToPlayerId[guestDisplayName] = guestId;

        // Initialize scores for the new guest player
        const course = coursesData.find(c => c.id == currentRound.courseId);
        if (course) {
            const newGuestScores = new Array(course.holes.length).fill(0);
            currentRound.scores[guestId] = newGuestScores;
        }

        // Save to database
        const { error } = await supabase
            .from('rounds')
            .update({
                players: [...currentRound.registeredPlayerIds.map(id => currentRound.playerIdToUsername[id]), ...currentRound.guestPlayers.map(name => `${name} (Guest)`)],
                player_ids: currentRound.registeredPlayerIds,
                player_usernames: currentRound.playerIdToUsername,
                guest_players: currentRound.guestPlayers,
                scores: currentRound.scores,
                updated_at: new Date()
            })
            .eq('id', currentRound.id);

        if (error) {
            console.error('Error adding guest player:', error);
            // Revert changes
            const guestIndex = currentRound.playerIds.indexOf(guestId);
            if (guestIndex > -1) {
                currentRound.playerIds.splice(guestIndex, 1);
                currentRound.guestPlayers.pop();
                delete currentRound.scores[guestId];
                delete currentRound.playerIdToUsername[guestId];
                delete currentRound.usernameToPlayerId[guestDisplayName];
            }
            
            Swal.fire({
                icon: "error",
                title: "Error",
                text: "Failed to add guest player to the round.",
            });
            return;
        }

        // Recreate the scorecard with updated players
        if (course) {
            const allPlayerNames = [...currentRound.registeredPlayerIds.map(id => currentRound.playerIdToUsername[id]), ...currentRound.guestPlayers.map(name => `${name} (Guest)`)];
            createScorecard(course, allPlayerNames);
        }

        Swal.fire({
            title: "Guest Added!",
            text: `${cleanGuestName} has been added to the round.`,
            icon: "success",
            timer: 2000,
            showConfirmButton: false
        });

    } catch (error) {
        console.error('Error adding guest player:', error);
        Swal.fire({
            icon: "error",
            title: "Error",
            text: "Failed to add guest player.",
        });
    }
}

async function setScoreToPar(player, holeIndex) {
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

    // Set score to par
    currentRound.scores[playerId][holeIndex] = par;
    
    console.log(`Set ${player} (${playerId}) hole ${holeIndex + 1} to par (${par})`);

    // Update display
    const scoreElement = document.getElementById(`score-${player}-${holeIndex}`);
    if (scoreElement) {
        scoreElement.textContent = par;
    }

    // Update the player's score difference display
    updatePlayerScoreDisplay(player, holeIndex, par, par);

    // Update totals
    updateTotals();

    // Save to Supabase
    await saveCurrentRoundScores();
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

            // Always expand new round section after deleting - ADDED
            if (!isNewRoundExpanded) {
                toggleNewRoundSection();
            }

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
        // If hole hasn't been played, start from par + change
        newScore = par + change;
    } else {
        // If hole has been played, modify existing score
        newScore = parseInt(currentScore) + change;
    }

    // Ensure score stays within reasonable bounds (but allow going back to 0 to "unplay" a hole)
    if (newScore < 0) newScore = 0; // Allow 0 to represent "unplayed"
    if (newScore > 10) newScore = 10;

    // Update local state
    currentRound.scores[playerId][holeIndex] = newScore;
    
    console.log(`Updated ${player} (${playerId}) hole ${holeIndex + 1} to ${newScore}`);

    // Update display (still use username for UI)
    const scoreElement = document.getElementById(`score-${player}-${holeIndex}`);
    if (scoreElement) {
        scoreElement.textContent = newScore > 0 ? newScore : '-';
    }

    // Update the player's score difference display - FIX: Update in real-time
    updatePlayerScoreDisplay(player, holeIndex, newScore, par);

    // Update totals
    updateTotals();

    // Save to Supabase
    await saveCurrentRoundScores();
}

function updatePlayerScoreDisplay(player, holeIndex, newScore, par) {
    // Update the score info element with the specific ID
    const scoreInfoElement = document.getElementById(`score-info-${player}-${holeIndex}`);
    if (scoreInfoElement) {
        if (newScore > 0) {
            const scoreDiff = newScore - par;
            const scoreText = scoreDiff === 0 ? 'E' : scoreDiff > 0 ? `+${scoreDiff}` : scoreDiff.toString();
            scoreInfoElement.textContent = `${scoreText} (${newScore})`;
        } else {
            // If score is 0 (unplayed), show different display
            scoreInfoElement.textContent = `Skipped`;
        }
    }
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
        const username = currentRound.playerIdToUsername[playerId];
        const totalElement = document.getElementById(`total-${username.replace(/\s+/g, '-')}`);
        
        if (totalElement) {
            // Only count holes that have been played (score > 0)
            const playedHoles = scores.filter(score => score && score > 0);
            const playedHolesPar = playedHoles.length > 0 ? 
                scores.map((score, index) => score && score > 0 ? course.holes[index] : 0)
                     .reduce((sum, par) => sum + par, 0) : 0;
            
            if (playedHoles.length > 0) {
                const total = playedHoles.reduce((sum, score) => sum + score, 0);
                const scoreToPar = total - playedHolesPar;
                const scoreToParText = scoreToPar === 0 ? 'E' : 
                                     scoreToPar > 0 ? `+${scoreToPar}` : 
                                     scoreToPar.toString();
                
                totalElement.textContent = `${total} (${scoreToParText})`;
            } else {
                totalElement.textContent = '-';
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
        // Get course data to check total holes
        const course = coursesData.find(c => c.id == currentRound.courseId);
        if (!course) {
            Swal.fire({
                icon: "error",
                title: "Error",
                text: "Could not find course information",
            });
            return;
        }

        // Check if all players have completed all holes
        const incompleteData = checkForIncompleteRounds(course);
        
        if (incompleteData.hasIncomplete) {
            const result = await Swal.fire({
                title: 'Incomplete Round Detected',
                html: `
                    <div style="text-align: left;">
                        <p style="margin-bottom: 15px;">Some players haven't completed all holes:</p>
                        <div style="background: #f8f9fa; padding: 12px; border-radius: 8px; margin: 15px 0;">
                            ${incompleteData.details.map(detail => 
                                `<div style="margin-bottom: 8px;">
                                    <strong>${detail.player}:</strong> ${detail.completedHoles}/${course.holes.length} holes completed
                                </div>`
                            ).join('')}
                        </div>
                        <p style="color: #666; font-size: 14px;">
                            Only completed holes will be counted in the final scores. 
                            Are you sure you want to finish this round?
                        </p>
                    </div>
                `,
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#f59e0b',
                cancelButtonColor: '#6c757d',
                confirmButtonText: 'Yes, Finish Round',
                cancelButtonText: 'Continue Playing',
                width: '90%',
                maxWidth: '500px'
            });

            if (!result.isConfirmed) {
                return; // User chose to continue playing
            }
        }

        // Calculate final scores - include both registered users and guests
        const finalScoresByUsername = {};

        Object.keys(currentRound.scores).forEach(playerId => {
            const scores = currentRound.scores[playerId];
            const username = currentRound.playerIdToUsername[playerId];
            
            if (username) {
                // Only count holes that have been played (score > 0)
                const playedScores = scores.filter(score => score && score > 0);
                
                if (playedScores.length > 0) {
                    const totalScore = playedScores.reduce((sum, score) => sum + score, 0);
                    finalScoresByUsername[username] = totalScore;
                }
                // Don't save anything if no holes were played - this prevents 0 scores
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

        // Show success message
        Swal.fire({
            title: "Round Completed!",
            text: 'Your round has been saved successfully for all players.',
            icon: "success",
            timer: 3000,
            showConfirmButton: false
        });

        showCanvasConfetti();
        
        document.getElementById('scorecard').style.display = 'none';
        document.getElementById('course').value = '';
        
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
        container.className = 'space-y-3';

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

        // Group rounds by date
        const roundsByDate = {};
        rounds.forEach(round => {
            const date = round.date;
            if (!roundsByDate[date]) {
                roundsByDate[date] = [];
            }
            roundsByDate[date].push(round);
        });

        // Get sorted dates (most recent first)
        const sortedDates = Object.keys(roundsByDate).sort((a, b) => new Date(b) - new Date(a));
        
        // Create date groups
        sortedDates.forEach((date, dateIndex) => {
            const roundsForDate = roundsByDate[date];
            const isLatestDate = dateIndex === 0; // Only latest date is open by default
            
            // Create date group container
            const dateGroup = document.createElement('div');
            dateGroup.className = 'bg-white rounded-xl shadow-md border border-gray-200 overflow-hidden';
            dateGroup.id = `date-group-${dateIndex}`;

            // Calculate date stats
            const totalRoundsForDate = roundsForDate.length;
            const scoresRelativeToParForDate = roundsForDate
                .map(round => {
                    if (round.final_scores && currentUsername && round.final_scores[currentUsername] != null) {
                        const userScore = round.final_scores[currentUsername];
                        // Find course to get par
                        const course = coursesData.find(c => c.id == round.course_id);
                        const par = course ? course.holes.reduce((a, b) => a + b, 0) : 0;
                        return par > 0 ? userScore - par : null;
                    }
                    return null;
                })
                .filter(score => score !== null);

            const avgScoreForDate = scoresRelativeToParForDate.length > 0 ? 
                (() => {
                    const avg = (scoresRelativeToParForDate.reduce((a, b) => a + b, 0) / scoresRelativeToParForDate.length);
                    return avg >= 0 ? `+${avg.toFixed(1)}` : avg.toFixed(1);
                })() : '-';
            const bestScoreForDate = scoresRelativeToParForDate.length > 0 ? 
                (() => {
                    const best = Math.min(...scoresRelativeToParForDate);
                    return best >= 0 ? `+${best}` : best.toString();
                })() : '-';

            // Format date for display
            const dateObj = new Date(date + 'T00:00:00');
            const today = new Date();
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
            
            let displayDate;
            if (dateObj.toDateString() === today.toDateString()) {
                displayDate = 'Today';
            } else if (dateObj.toDateString() === yesterday.toDateString()) {
                displayDate = 'Yesterday';
            } else {
                displayDate = date;
                date = "";
            }

            dateGroup.innerHTML = `
                <!-- Date Header -->
                <button onclick="toggleDateGroup(${dateIndex})" 
                        class="w-full p-4 text-left hover:bg-gray-50 transition-colors duration-200 focus:outline-none">
                    <div class="flex justify-between items-center">
                        <div class="flex-1">
                            <div class="flex items-center justify-between mb-2">
                                <div class="flex items-baseline gap-2">
                                    <h3 class="text-lg font-bold text-gray-900">${displayDate}</h3>
                                    <span class="text-sm text-gray-400">${date}</span>
                                </div>
                                <div class="text-sm text-gray-600 font-medium">
                                    ${totalRoundsForDate} round${totalRoundsForDate !== 1 ? 's' : ''}
                                </div>
                            </div>
                            <div class="flex items-center gap-6 text-sm text-gray-600">
                                <span>Avg: <strong class="text-indigo-600">${avgScoreForDate}</strong> │ Best: <strong class="text-green-600">${bestScoreForDate}</strong></span>
                            </div>
                        </div>
                        <div id="date-chevron-${dateIndex}" class="ml-4 transform transition-transform duration-300 ${isLatestDate ? 'rotate-180' : ''}">
                            <svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
                            </svg>
                        </div>
                    </div>
                </button>

                <!-- Rounds Content -->
                <div id="date-content-${dateIndex}" class="border-t border-gray-200 transition-all duration-300 ease-in-out overflow-hidden ${isLatestDate ? '' : 'max-h-0'}">
                    <div class="p-2">
                        ${roundsForDate.map((round, roundIndex) => createRoundItem(round, `${dateIndex}-${roundIndex}`, currentUsername, user.id)).join('')}
                    </div>
                </div>
            `;

            container.appendChild(dateGroup);
        });

    } catch (error) {
        console.error('Error loading history:', error);
        container.innerHTML = '<div class="text-center text-red-500">Error loading history</div>';
    }
}

// Helper function to get position text with proper handling of ties
function getPositionText(position) {
    const suffixes = {
        1: '1st',
        2: '2nd', 
        3: '3rd'
    };
    
    return suffixes[position] || `${position}th`;
}

// Helper function to get badge colors for different positions
function getPositionBadgeColor(position) {
    switch(position) {
        case 1:
            return 'bg-yellow-100 text-yellow-800'; // Gold for 1st
        case 2:
            return 'bg-gray-100 text-gray-800'; // Silver for 2nd
        case 3:
            return 'bg-orange-100 text-orange-800'; // Bronze for 3rd
        default:
            return 'bg-blue-100 text-blue-800'; // Blue for other positions
    }
}

function createRoundItem(round, itemId, currentUsername, userId) {
    // Find course data for par calculation
    const course = coursesData.find(c => c.id == round.course_id);

    // Calculate played par instead of total course par
    let playedPar = 0;
    const userScores = getUserHoleScores(round, userId, currentUsername);
    
    if (course && userScores && userScores.length > 0) {
        userScores.forEach((holeScore, index) => {
            if (holeScore > 0 && index < course.holes.length) {
                playedPar += course.holes[index];
            }
        });
    }
    
    // Get current user's score
    let yourScore = 0;
    if (round.final_scores_by_id && round.final_scores_by_id[userId]) {
        yourScore = round.final_scores_by_id[userId];
    } else if (round.final_scores && currentUsername && round.final_scores[currentUsername]) {
        yourScore = round.final_scores[currentUsername];
    }

    // Calculate score difference text using played par
    const scoreDiff = yourScore > 0 && playedPar > 0 ? yourScore - playedPar : null;
    const scoreDiffText = scoreDiff === null ? '' : 
        scoreDiff > 0 ? `+${scoreDiff}` : 
        scoreDiff === 0 ? 'E' : 
        scoreDiff.toString();

    // Get all players with their scores and handle ties
    let allPlayers = [];
    if (round.player_usernames && round.final_scores_by_id) {
        allPlayers = Object.entries(round.final_scores_by_id)
            .map(([playerId, score]) => ({
                name: round.player_usernames[playerId] || (playerId.startsWith('guest_') ? 'Guest Player' : 'Unknown'),
                score: score
            }));
    } else if (round.final_scores) {
        allPlayers = Object.entries(round.final_scores)
            .map(([player, score]) => ({ name: player, score: score }));
    }

    // Sort by score (lowest first)
    allPlayers.sort((a, b) => a.score - b.score);

    // Create leaderboard with tie handling
    const leaderboard = [];
    let currentPosition = 1;
    let previousScore = null;
    let playersAtPosition = 0;

    allPlayers.forEach((player, index) => {
        if (previousScore !== null && player.score !== previousScore) {
            // Move to next position, skipping positions for tied players
            currentPosition += playersAtPosition;
            playersAtPosition = 0;
        }
        
        playersAtPosition++;
        previousScore = player.score;
        
        const playerScoreToPar = player.score - playedPar;
        const playerScoreToParText = playerScoreToPar === 0 ? 'E' : 
                                    playerScoreToPar > 0 ? `+${playerScoreToPar}` : 
                                    playerScoreToPar.toString();
        
        // Display based on global toggle
        const displayText = showScoreDifference ? 
            `${getPositionText(currentPosition)} ${player.name}: ${playerScoreToParText}` :
            `${getPositionText(currentPosition)} ${player.name}: ${player.score}`;
        
        leaderboard.push({
            position: currentPosition,
            displayText: displayText,
            player: player
        });
    });

    return `
    <div class="bg-white rounded-xl shadow-md hover:shadow-lg border border-gray-200 transition-all duration-200 hover:border-indigo-300 overflow-hidden m-3" 
        data-round-id="${round.id}">
        
        <div class="p-6" onclick="toggleRoundItem('${itemId}')">
            <div class="flex justify-between items-start mb-4">
                <div>
                    <h3 class="text-xl font-bold text-gray-900 mb-1">${round.course_name}</h3> 
                </div>
                <div class="text-right">
                    ${showScoreDifference ? 
                        (scoreDiffText ? `<div class="text-xl font-bold ${scoreDiff > 0 ? 'text-red-500' : scoreDiff < 0 ? 'text-green-500' : 'text-gray-600'}">${scoreDiffText}</div>` : '') :
                        `<div class="text-xl font-bold text-indigo-600">${yourScore || '-'}</div>`
                    }
                </div>
            </div>
            
            ${leaderboard.length > 0 ? `
                <div class="flex flex-wrap gap-2">
                    <p class="text-sm font-medium text-gray-700 mb-2">Leaderboard (played par ${playedPar}):</p>
                    <div class="flex flex-wrap gap-2">
                        ${leaderboard.map((item) => {
                            const badgeColor = getPositionBadgeColor(item.position);
                            return `
                                <span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${badgeColor}">
                                    ${item.displayText}
                                </span>
                            `;
                        }).join('')}
                    </div>
                </div>
            ` : ''}
        </div>

        <!-- Toggle Controls - Outside the clickable area -->
        <div class="bg-gray-100 px-4 py-2 border-t border-gray-200" onclick="event.stopPropagation();">
            <div class="flex items-center justify-between">
                <div class="flex items-center">
                    <div id="round-chevron-${itemId}" class="transform transition-transform duration-300 inline-block mr-2">
                        <svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
                        </svg>
                    </div>
                    <span class="text-xs text-gray-500" onclick="toggleRoundItem('${itemId}')">Click to view hole-by-hole</span>
                </div>
            </div>
        </div>

        <!-- Expandable Section for Hole-by-Hole Scorecard -->
        <div id="round-content-${itemId}" class="border-t border-gray-200 transition-all duration-300 ease-in-out overflow-hidden max-h-0">
            <!-- Content will be loaded here when expanded -->
        </div>
    </div>
`;
}

function checkForIncompleteRounds(course) {
    const totalHoles = course.holes.length;
    const incompleteDetails = [];
    let hasIncomplete = false;

    Object.keys(currentRound.scores).forEach(playerId => {
        const scores = currentRound.scores[playerId];
        const username = currentRound.playerIdToUsername[playerId];
        
        if (username) {
            // Count holes with scores > 0
            const completedHoles = scores.filter(score => score && score > 0).length;
            
            if (completedHoles < totalHoles && completedHoles > 0) {
                // Player has started but not finished
                hasIncomplete = true;
                incompleteDetails.push({
                    player: username,
                    completedHoles: completedHoles,
                    totalHoles: totalHoles
                });
            } else if (completedHoles === 0) {
                // Player hasn't played any holes
                hasIncomplete = true;
                incompleteDetails.push({
                    player: username,
                    completedHoles: 0,
                    totalHoles: totalHoles
                });
            }
        }
    });

    return {
        hasIncomplete,
        details: incompleteDetails
    };
}

// Update the toggleScoreDisplay function:
function toggleScoreDisplay(checkbox) {
    showScoreDifference = !checkbox.checked;
    
    // Update all toggle labels on the page
    document.querySelectorAll('.score-toggle-label').forEach(label => {
        label.textContent = showScoreDifference ? '±Par' : 'Total';
    });
    
    // Update all toggle checkboxes to stay in sync
    document.querySelectorAll('.score-toggle input').forEach(input => {
        input.checked = !showScoreDifference;
    });
    
    // Refresh current displays
    const historySection = document.getElementById('history');
    if (historySection && historySection.classList.contains('active')) {
        loadHistory(); // This will now use the updated toggle state
    }
}

function toggleRoundItem(itemId) {
    const content = document.getElementById(`round-content-${itemId}`);
    const chevron = document.getElementById(`round-chevron-${itemId}`);
    const toggleText = content.closest('.bg-white').querySelector('.bg-gray-100 .text-xs.text-gray-500');
    
    if (content.classList.contains('max-h-0')) {
        // Expanding
        content.classList.remove('max-h-0');
        content.classList.add('max-h-none');
        chevron.style.transform = 'rotate(180deg)';
        toggleText.textContent = 'Click to hide hole-by-hole';
        
        // Load the scorecard content
        const roundId = content.closest('[data-round-id]').getAttribute('data-round-id');
        loadRoundScorecard(roundId, itemId);
    } else {
        // Collapsing
        content.classList.add('max-h-0');
        content.classList.remove('max-h-none');
        chevron.style.transform = 'rotate(0deg)';
        toggleText.textContent = 'Click to view hole-by-hole';
        content.innerHTML = '';
    }
}

// Current filter state
let currentProgressFilter = 'all';

function toggleProgressFilter() {
    const dropdown = document.getElementById('progress-filter-dropdown');
    dropdown.classList.toggle('hidden');
}

function setProgressFilter(filter) {
    currentProgressFilter = filter;

    // Update label
    const labels = {
        'week': 'This Week',
        'month': 'This Month',
        'year': 'This Year',
        'all': 'All Time'
    };
    document.getElementById('filter-label').textContent = labels[filter];

    // Update checkmarks
    document.querySelectorAll('[data-filter]').forEach(el => {
        el.classList.add('hidden');
    });
    document.querySelector(`[data-filter="${filter}"]`).classList.remove('hidden');

    // Hide dropdown
    document.getElementById('progress-filter-dropdown').classList.add('hidden');

    // Refresh progress data
    updateProgress();
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('progress-filter-dropdown');
    const button = document.getElementById('progress-filter-btn');
    if (dropdown && button && !dropdown.contains(e.target) && !button.contains(e.target)) {
        dropdown.classList.add('hidden');
    }
});

function filterRoundsByDate(rounds) {
    if (currentProgressFilter === 'all') return rounds;

    const now = new Date();
    let startDate;

    switch (currentProgressFilter) {
        case 'week':
            startDate = new Date(now);
            startDate.setDate(now.getDate() - 7);
            break;
        case 'month':
            startDate = new Date(now);
            startDate.setMonth(now.getMonth() - 1);
            break;
        case 'year':
            startDate = new Date(now);
            startDate.setFullYear(now.getFullYear() - 1);
            break;
        default:
            return rounds;
    }

    return rounds.filter(round => new Date(round.created_at) >= startDate);
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

        // Filter rounds where user actually has a score AND played at least one hole
        let yourRounds = rounds.filter(round => {
            if (round.final_scores && currentUsername && round.final_scores[currentUsername] != null && round.final_scores[currentUsername] > 0) {
                return true;
            }
            return false;
        });

        // Apply date filter
        yourRounds = filterRoundsByDate(yourRounds);
        
        document.getElementById('total-rounds').textContent = yourRounds.length;
        
        if (yourRounds.length === 0) {
            // Reset all displays for no data
            document.getElementById('avg-score').textContent = '-';
            document.getElementById('total-throws').textContent = '-'; // ADD THIS LINE
            document.getElementById('best-par').textContent = '-';
            document.getElementById('last-5-avg').textContent = '-';
            document.getElementById('improvement-trend').textContent = '-';
            document.getElementById('best-course').textContent = 'No rounds yet';
            document.getElementById('score-distribution').innerHTML = '<p class="text-gray-500 text-center py-8">No rounds completed yet</p>';
            document.getElementById('course-performance').innerHTML = '<p class="text-gray-500 text-center py-8">No rounds completed yet</p>';
            return;
        }

        // Calculate detailed statistics - WAIT for coursesData to be loaded
        if (!coursesData || coursesData.length === 0) {
            console.log('Courses data not loaded yet, waiting...');
            await loadCourses();
        }

        const roundsWithDetails = yourRounds.map(round => {
            const score = round.final_scores[currentUsername];
            const course = coursesData.find(c => c.id == round.course_id);
            
            if (!course) return null;
            
            // Calculate par only for holes that were actually played
            let playedPar = 0;
            let playedHoles = 0;
            const userScores = getUserHoleScores(round, user.id, currentUsername);
            
            if (userScores && userScores.length > 0) {
                userScores.forEach((holeScore, index) => {
                    if (holeScore > 0 && index < course.holes.length) {
                        playedPar += course.holes[index];
                        playedHoles++;
                    }
                });
            }
            
            const scoreToPar = playedPar > 0 && score > 0 ? score - playedPar : 0;
            
            return {
                ...round,
                score,
                par: playedPar, // This is now the played par, not total course par
                scoreToPar,
                course,
                holeScores: userScores,
                playedHoles
            };
        }).filter(round => round && round.par > 0 && round.score > 0); // Only include rounds with valid played data

        if (roundsWithDetails.length === 0) {
            document.getElementById('score-distribution').innerHTML = '<p class="text-gray-500 text-center py-8">No valid course data available</p>';
            document.getElementById('course-performance').innerHTML = '<p class="text-gray-500 text-center py-8">No valid course data available</p>';
            return;
        }

        // Basic stats calculation
        const scores = roundsWithDetails.map(r => r.score);
        const scoresToPar = roundsWithDetails.map(r => r.scoreToPar);

        // Calculate total throws (sum of all scores)
        const totalThrows = scores.reduce((sum, score) => sum + score, 0);

        // Calculate average score relative to par
        const avgToPar = (scoresToPar.reduce((a, b) => a + b, 0) / scoresToPar.length).toFixed(1);

        // Find best round relative to par (lowest score relative to par)
        const bestToPar = Math.min(...scoresToPar);

        // Update the displays with correct values
        document.getElementById('total-throws').textContent = totalThrows.toLocaleString(); // Total throws across all rounds
        document.getElementById('avg-score').textContent = avgToPar == 0 ? 'E' : (avgToPar > 0 ? `+${avgToPar}` : avgToPar); // Average relative to par
        document.getElementById('best-par').textContent = bestToPar == 0 ? 'E' : (bestToPar > 0 ? `+${bestToPar}` : bestToPar); // Best round relative to par
        
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
        updateScoreDistribution(roundsWithDetails);
        
        // Course performance analysis
        updateCoursePerformance(roundsWithDetails);

    } catch (error) {
        console.error('Error updating progress:', error);
    }
}

// Add this new function for score distribution
function updateScoreDistribution(roundsWithDetails) {
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

    if (totalHoles === 0) {
        distributionContainer.innerHTML = '<p class="text-gray-500 text-center py-8">No hole-by-hole data available</p>';
        return;
    }

    // Create stacked bar visualization
    const stackedBar = document.createElement('div');
    stackedBar.className = 'mb-6';

    // Bar container
    const barContainer = document.createElement('div');
    barContainer.className = 'w-full h-5 bg-gray-200 rounded-full overflow-hidden flex';
    
    // Score type colors and order (from best to worst)
    const scoreOrder = [
        { key: 'Ace (Hole-in-one)', label: 'Ace', color: 'bg-purple-600', textColor: 'text-purple-600' },
        { key: 'Albatross (-3)', label: 'Albatross', color: 'bg-purple-500', textColor: 'text-purple-500' },
        { key: 'Eagle (-2)', label: 'Eagle', color: 'bg-blue-500', textColor: 'text-blue-500' },
        { key: 'Birdie (-1)', label: 'Birdie', color: 'bg-green-500', textColor: 'text-green-500' },
        { key: 'Par (E)', label: 'Par', color: 'bg-gray-400', textColor: 'text-gray-600' },
        { key: 'Bogey (+1)', label: 'Bogey', color: 'bg-yellow-500', textColor: 'text-yellow-600' },
        { key: 'Double Bogey (+2)', label: 'Double', color: 'bg-orange-500', textColor: 'text-orange-600' },
        { key: 'Triple+ (+3)', label: 'Triple+', color: 'bg-red-500', textColor: 'text-red-600' }
    ];

    // Create segments
    scoreOrder.forEach(scoreType => {
        const count = scoreTypes[scoreType.key];
        const percentage = totalHoles > 0 ? (count / totalHoles * 100) : 0;
        
        if (count > 0) {
            const segment = document.createElement('div');
            segment.className = `${scoreType.color} flex items-center justify-center transition-all duration-300 hover:opacity-80`;
            segment.style.width = `${percentage}%`;
            segment.title = `${scoreType.label}: ${count} (${percentage.toFixed(1)}%)`;
            
            // Only show text if segment is wide enough
            if (percentage > 8) {
                segment.innerHTML = `<span class="text-white text-xs font-semibold">${count}</span>`;
            }
            
            barContainer.appendChild(segment);
        }
    });

    stackedBar.appendChild(barContainer);

    // Legend below the bar
    const legend = document.createElement('div');
    legend.className = 'mt-4 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs';
    
    scoreOrder.forEach(scoreType => {
        const count = scoreTypes[scoreType.key];
        const percentage = totalHoles > 0 ? (count / totalHoles * 100).toFixed(1) : 0;
        
        if (count > 0) {
            const legendItem = document.createElement('div');
            legendItem.className = 'flex items-center gap-2';
            legendItem.innerHTML = `
                <div class="w-3 h-3 ${scoreType.color} rounded"></div>
                <span class="${scoreType.textColor} font-medium">${scoreType.label}: ${count} (${percentage}%)</span>
            `;
            legend.appendChild(legendItem);
        }
    });

    stackedBar.appendChild(legend);
    distributionContainer.appendChild(stackedBar);
}

function getColorForPercentage(gradientClass) {
    const colorMap = {
        'bg-gradient-to-r from-purple-500 to-purple-600': '#a855f7',
        'bg-gradient-to-r from-purple-400 to-purple-500': '#c084fc',
        'bg-gradient-to-r from-blue-500 to-blue-600': '#3b82f6',
        'bg-gradient-to-r from-green-500 to-green-600': '#10b981',
        'bg-gradient-to-r from-gray-400 to-gray-500': '#9ca3af',
        'bg-gradient-to-r from-yellow-500 to-yellow-600': '#eab308',
        'bg-gradient-to-r from-orange-500 to-orange-600': '#f97316',
        'bg-gradient-to-r from-red-500 to-red-600': '#ef4444'
    };
    
    return colorMap[gradientClass] || '#9ca3af';
}

// Add this new function for course performance
function updateCoursePerformance(roundsWithDetails) {
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

    if (Object.keys(courseStats).length === 0) {
        courseContainer.innerHTML = '<p class="text-gray-500 text-center py-8">No course data available</p>';
        return;
    }

    // Calculate overall average to par for comparison
    const allCoursesAvgToPar = Object.values(courseStats).reduce((sum, stats) => {
        return sum + (stats.totalToPar / stats.rounds);
    }, 0) / Object.keys(courseStats).length;

    Object.entries(courseStats)
        .sort(([,a], [,b]) => (a.totalToPar / a.rounds) - (b.totalToPar / b.rounds))
        .forEach(([courseName, stats]) => {
            const avgToPar = (stats.totalToPar / stats.rounds).toFixed(1);
            const courseAvgToPar = stats.totalToPar / stats.rounds;
            
            // Determine performance relative to other courses
            let performanceLevel, borderColor, textColor;
            if (courseAvgToPar < allCoursesAvgToPar - 1) {
                // Significantly better than average
                performanceLevel = 'excellent';
                borderColor = 'border-green-500';
                textColor = 'text-green-600';
            } else if (courseAvgToPar < allCoursesAvgToPar) {
                // Better than average
                performanceLevel = 'good';
                borderColor = 'border-green-400';
                textColor = 'text-green-500';
            } else if (courseAvgToPar <= allCoursesAvgToPar + 1) {
                // Around average
                performanceLevel = 'average';
                borderColor = 'border-yellow-500';
                textColor = 'text-yellow-600';
            } else {
                // Worse than average
                performanceLevel = 'poor';
                borderColor = 'border-red-500';
                textColor = 'text-red-600';
            }
            
            const courseCard = document.createElement('div');
            courseCard.className = `flex items-center justify-between p-4 bg-white rounded-lg border-l-4 shadow-sm ${borderColor}`;
            courseCard.innerHTML = `
                <div>
                    <h4 class="font-semibold text-gray-800">${courseName}</h4>
                    <p class="text-sm text-gray-600">${stats.rounds} round${stats.rounds !== 1 ? 's' : ''} played</p>
                </div>
                <div class="text-right">
                    <div class="font-bold text-lg ${textColor}">
                        ${avgToPar == 0 ? 'E' : (avgToPar >= 0 ? '+' : '')}${avgToPar}
                    </div>
                    <div class="text-sm text-gray-600">
                        Best: ${stats.bestToPar == 0 ? 'E' : (stats.bestToPar >= 0 ? '+' : '')}${stats.bestToPar}
                    </div>
                </div>
            `;
            courseContainer.appendChild(courseCard);
        });
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

        if (yourRounds.length === 0) {
            // Reset all displays for no data
            document.getElementById('avg-score').textContent = '-';
            document.getElementById('total-throws').textContent = '-'; // Add this line
            document.getElementById('best-par').textContent = '-';
            document.getElementById('last-5-avg').textContent = '-';
            document.getElementById('improvement-trend').textContent = '-';
            document.getElementById('best-course').textContent = 'No rounds yet';
            document.getElementById('score-distribution').innerHTML = '<p class="text-gray-500 text-center py-8">No rounds completed yet</p>';
            document.getElementById('course-performance').innerHTML = '<p class="text-gray-500 text-center py-8">No rounds completed yet</p>';
            return;
        }
        
        if (yourRounds.length > 0) {
            // Basic stats calculation - Replace the existing basic stats section with this:
            const scores = roundsWithDetails.map(r => r.score);
            const scoresToPar = roundsWithDetails.map(r => r.scoreToPar);

            // Calculate total throws with debugging
            console.log('Rounds with details:', roundsWithDetails.length);
            console.log('Scores array:', scores);
            console.log('Sample round scores:', roundsWithDetails.slice(0, 2).map(r => ({ score: r.score, type: typeof r.score })));

            // More robust total throws calculation
            const totalThrows = roundsWithDetails.reduce((sum, round) => {
                const score = round.score;
                if (score && typeof score === 'number' && score > 0) {
                    return sum + score;
                }
                return sum;
            }, 0);

            console.log('Calculated total throws:', totalThrows);

            // Calculate average score (actual strokes, not relative to par)
            const avgScore = (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1);

            // Find best round (lowest score)
            const bestScore = Math.min(...scores);
            const bestRound = roundsWithDetails.find(r => r.score === bestScore);

            // Update the displays
            document.getElementById('total-throws').textContent = totalThrows.toLocaleString(); // Format with commas for large numbers
            document.getElementById('avg-score').textContent = avgScore;
            document.getElementById('best-par').textContent = bestScore; // Show actual best score, not relative to par

            // Keep the existing avgToPar calculation if you need it elsewhere
            const avgToPar = (scoresToPar.reduce((a, b) => a + b, 0) / scoresToPar.length).toFixed(1);
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
        const { data: inProgressRounds, error } = await supabase
            .from('rounds')
            .select('*')
            .eq('user_id', user.id)
            .eq('status', 'in_progress')
            .order('created_at', { ascending: false })
            .limit(1);

        if (error) {
            console.error('Error loading current round:', error);
            return;
        }

        const inProgressRound = inProgressRounds && inProgressRounds.length > 0 ? inProgressRounds[0] : null;

        if (inProgressRound) {
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

// Add this function to script.js
function adjustHeaderForViewport() {
    const header = document.querySelector('.header');
    const subtitle = document.querySelector('.header-text p');
    const title = document.querySelector('.header-text h1');
    
    if (!header || !subtitle || !title) return;
    
    const viewportHeight = window.innerHeight;
    
    // Remove existing classes
    header.classList.remove('compact-header', 'minimal-header', 'tiny-header');
    subtitle.classList.remove('hidden');
    
    if (viewportHeight <= 500) {
        header.classList.add('tiny-header');
        subtitle.classList.add('hidden');
    } else if (viewportHeight <= 600) {
        header.classList.add('minimal-header');
        subtitle.classList.add('hidden');
    } else if (viewportHeight <= 700) {
        header.classList.add('compact-header');
        subtitle.classList.add('hidden');
    }
}

// Add these loading screen functions
function showLoadingScreen() {
    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen) {
        loadingScreen.style.display = 'flex';
    }
}

function hideLoadingScreen() {
    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen) {
        loadingScreen.style.display = 'none';
    }
}

// Enhanced showSection with loading protection
function showSectionWithLoadingProtection(sectionId) {
    if (isAppLoading) {
        console.log('App still loading, ignoring navigation request');
        return;
    }
    showSection(sectionId);
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

async function loginSuccessful() {
    // Add this to your loginSuccessful function or early in the app
    addRainAnimationStyles();
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('main-app').style.display = 'block';
    
    // Show loading state for weather
    const weatherWidget = document.getElementById('weather-widget');
    const weatherIcon = document.getElementById('weather-icon');
    const weatherTemp = document.getElementById('weather-temp');
    const weatherDesc = document.getElementById('weather-desc');
    
    if (weatherWidget && weatherIcon && weatherTemp && weatherDesc) {
        weatherIcon.textContent = '🔄';
        weatherTemp.textContent = '...';
        weatherDesc.textContent = 'Loading...';
        weatherWidget.classList.remove('hidden');
        weatherWidget.classList.add('flex');
    }
    
    // Set default section and nav state
    showSection('new-round');
    
    // Load all necessary data
    try {
        await Promise.all([
            loadProfile(),
            loadCourses(),
            startLocationUpdates(),
            loadWeather()
        ]);
        
        await loadCurrentRound();
        
        // START WEATHER AUTO-REFRESH
        startWeatherAutoRefresh();
        
        // Restore UI state
        setTimeout(() => {
            restoreNewRoundState();
        }, 100);
        
    } catch (error) {
        console.error('Error loading app data:', error);
        // Hide weather widget if loading fails
        if (weatherWidget) {
            weatherWidget.classList.add('hidden');
        }
    }
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
        // Validate file type
        if (!file.type.startsWith('image/')) {
            Swal.fire({
                icon: "error",
                title: "Invalid File Type",
                text: "Please select an image file",
            });
            return;
        }

        // Show loading
        Swal.fire({
            title: 'Processing Image...',
            allowOutsideClick: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });

        // Compress image if over 1MB, otherwise use original
        if (file.size > 1 * 1024 * 1024) {
            compressImageFile(file, 1, (compressedBase64) => {
                Swal.close();
                initializeCroppie(compressedBase64);
            });
        } else {
            const reader = new FileReader();
            reader.onload = function(e) {
                Swal.close();
                initializeCroppie(e.target.result);
            };
            reader.readAsDataURL(file);
        }
    }
}

let croppieInstance = null;
let isInitializing = false;

function initializeCroppie(imageSrc) {
    // Prevent multiple initializations
    if (isInitializing) {
        return;
    }

    isInitializing = true;

    initializeCroppieModal();
    
    const container = document.getElementById('croppie-container');
    
    // Destroy existing instance if it exists
    if (croppieInstance) {
        try {
            croppieInstance.destroy();
        } catch (error) {
            console.warn('Error destroying previous croppie instance:', error);
        }
        croppieInstance = null;
    }

    // Clear container before creating new instance
    container.innerHTML = '';
    
    setTimeout(() => {
        try {
            // Create new Croppie instance
            croppieInstance = new Croppie(container, {
                viewport: {
                    width: 200,
                    height: 200,
                    type: 'circle'
                },
                boundary: {
                    width: 300,
                    height: 300
                },
                showZoomer: true,
                enableResize: false,
                enableOrientation: true,
                mouseWheelZoom: 'ctrl',
                enableExif: true
            });
            
            // Load image and get its dimensions first
            const img = new Image();
            img.onload = function() {
                const imageWidth = img.naturalWidth;
                const imageHeight = img.naturalHeight;
                const viewportSize = 200;
                
                // Calculate appropriate zoom level to fit image nicely in viewport
                const scaleX = viewportSize / imageWidth;
                const scaleY = viewportSize / imageHeight;
                const minZoom = Math.min(scaleX, scaleY) * 0.8; // Allow zooming out a bit
                const maxZoom = 2.0; // Allow reasonable zoom in
                const initialZoom = Math.min(Math.max(scaleX, scaleY), 1) * 1.1; // Slightly bigger than minimum fit
                
                // Bind the image with calculated zoom
                croppieInstance.bind({
                    url: imageSrc,
                    zoom: initialZoom
                }).then(() => {
                    // Fix the zoom slider sensitivity after binding
                    setTimeout(() => {
                        const zoomSlider = container.querySelector('.cr-slider');
                        if (zoomSlider) {
                            // Override the step value to make it less sensitive
                            zoomSlider.step = '0.01'; // Much less sensitive
                            zoomSlider.min = minZoom;
                            zoomSlider.max = maxZoom;
                            zoomSlider.value = initialZoom;

                            // ACTIVATE THE IMAGE by triggering a zoom event
                            const event = new Event('input', { bubbles: true });
                            zoomSlider.dispatchEvent(event);

                            // Also programmatically trigger zoom change to activate dragging
                            croppieInstance.setZoom(initialZoom);
                            
                            // Also add custom event listener for better control
                            zoomSlider.addEventListener('input', function(e) {
                                const zoomValue = parseFloat(e.target.value);
                                if (croppieInstance && !isNaN(zoomValue)) {
                                    croppieInstance.setZoom(zoomValue);
                                }
                            });
                        }

                        // Additional activation - trigger a slight zoom change
                        setTimeout(() => {
                            const currentZoom = croppieInstance.get().zoom;
                            croppieInstance.setZoom(currentZoom + 0.001);
                            croppieInstance.setZoom(currentZoom);
                        }, 100);
                        
                    }, 100);
                    
                    // Show modal only after binding is complete
                    document.getElementById('croppie-modal').style.display = 'block';
                    isInitializing = false;
                }).catch((error) => {
                    console.error('Error binding image to croppie:', error);
                    isInitializing = false;
                });
            };
            
            img.onerror = function() {
                console.error('Error loading image for croppie');
                isInitializing = false;
            };
            
            img.src = imageSrc;
            
        } catch (error) {
            console.error('Error creating croppie instance:', error);
            isInitializing = false;
        }
    }, 100);
}

function initializeCroppieModal() {
    // Create modal HTML if it doesn't exist
    if (!document.getElementById('croppie-modal')) {
        const modalHTML = `
            <div id="croppie-modal" class="modal" style="display: none;">
                <div class="modal-content" style="max-width: 500px;">
                    <div class="modal-header">
                        <h3>Crop Profile Picture</h3>
                        <span class="close" onclick="closeCroppieModal()">&times;</span>
                    </div>
                    <div class="modal-body">
                        <div id="croppie-container"></div>
                        <div style="margin: 15px 0; text-align: center;">
                            <button type="button" onclick="applyCrop()" class="btn btn-primary">Apply Crop</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        
        // Add click outside to close functionality
        const modal = document.getElementById('croppie-modal');
        modal.addEventListener('click', function(event) {
            if (event.target === modal) {
                closeCroppieModal();
            }
        });
    }
}

async function applyCrop() {
    if (!croppieInstance) {
        console.warn('No croppie instance available');
        return;
    }
    
    try {
        const croppedBase64 = await croppieInstance.result({
            type: 'base64',
            size: 'viewport',
            format: 'jpeg',
            quality: 0.8,
            circle: false // Set to true if you want circular crop with transparent background
        });
        
        // Update the preview and selected picture
        selectedProfilePicture = croppedBase64;
        const previewElement = document.getElementById('profile-picture-preview');
        if (previewElement) {
            previewElement.src = croppedBase64;
        }
        
        closeCroppieModal();
    } catch (error) {
        console.error('Error applying crop:', error);
        if (typeof Swal !== 'undefined') {
            Swal.fire({
                icon: "error",
                title: "Crop Failed",
                text: "Failed to apply crop. Please try again.",
            });
        } else {
            alert('Failed to apply crop. Please try again.');
        }
    }
}

function closeCroppieModal() {
    const modal = document.getElementById('croppie-modal');
    if (modal) {
        modal.style.display = 'none';
    }
    
    // Clean up croppie instance with proper error handling
    if (croppieInstance) {
        try {
            // Give any pending operations a moment to complete
            setTimeout(() => {
                try {
                    croppieInstance.destroy();
                } catch (error) {
                    console.warn('Error destroying croppie instance:', error);
                } finally {
                    croppieInstance = null;
                    // Clear the container after destroying
                    const container = document.getElementById('croppie-container');
                    if (container) {
                        container.innerHTML = '';
                    }
                }
            }, 50);
        } catch (error) {
            console.warn('Error in cleanup process:', error);
            croppieInstance = null;
        }
    }
    
    // Reset initialization flag
    isInitializing = false;
}

function compressImageFile(file, maxSizeMB = 1, callback) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    
    img.onload = function() {
        // Calculate dimensions to maintain aspect ratio
        let { width, height } = img;
        const maxDimension = 1024; // Max width or height
        
        if (width > maxDimension || height > maxDimension) {
            if (width > height) {
                height = (height * maxDimension) / width;
                width = maxDimension;
            } else {
                width = (width * maxDimension) / height;
                height = maxDimension;
            }
        }
        
        canvas.width = width;
        canvas.height = height;
        
        // Draw image
        ctx.drawImage(img, 0, 0, width, height);
        
        // Start with high quality and reduce if needed
        let quality = 0.9;
        let compressedBase64;
        
        do {
            compressedBase64 = canvas.toDataURL('image/jpeg', quality);
            quality -= 0.1;
        } while (compressedBase64.length > maxSizeMB * 1024 * 1024 * 1.37 && quality > 0.1); // 1.37 factor for base64 overhead
        
        callback(compressedBase64);
    };
    
    const reader = new FileReader();
    reader.onload = e => img.src = e.target.result;
    reader.readAsDataURL(file);
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

    try {
        // Try to load profile from DB
        const { data, error } = await supabase
            .from("profiles")
            .select("username, bio, profile_picture_base64")
            .eq("id", user.id)
            .single();

        if (error && error.code === 'PGRST116') {
            // Profile doesn't exist, create one
            console.log('Profile not found, creating new profile for user:', user.id);
            
            const newProfile = {
                id: user.id,
                username: `User_${user.id.substring(0, 8)}`,
                bio: 'New disc golf player',
                created_at: new Date(),
                updated_at: new Date()
            };

            const { data: createdProfile, error: createError } = await supabase
                .from("profiles")
                .insert(newProfile)
                .select()
                .single();

            if (createError) {
                console.error('Error creating profile:', createError);
                document.getElementById("profile-username").value = newProfile.username;
                document.getElementById("profile-bio").value = newProfile.bio;
            } else {
                document.getElementById("profile-username").value = createdProfile.username || newProfile.username;
                document.getElementById("profile-bio").value = createdProfile.bio || newProfile.bio;
            }
            
            const defaultPicSrc = "./images/user.png";
            document.getElementById("profile-picture-preview").src = defaultPicSrc;
            document.getElementById("user-avatar").src = defaultPicSrc;
            
        } else if (error) {
            console.error('Error loading profile:', error);
            document.getElementById("profile-username").value = `User_${user.id.substring(0, 8)}`;
            document.getElementById("profile-bio").value = 'New disc golf player';
            document.getElementById("profile-picture-preview").src = "./images/user.png";
            document.getElementById("user-avatar").src = "./images/user.png";
            
        } else if (data) {
            // Profile exists, load it
            document.getElementById("profile-username").value = data.username || `User_${user.id.substring(0, 8)}`;
            document.getElementById("profile-bio").value = data.bio || 'New disc golf player';
            
            const profilePicSrc = data.profile_picture_base64 || "./images/user.png";
            document.getElementById("profile-picture-preview").src = profilePicSrc;
            document.getElementById("user-avatar").src = profilePicSrc;
        }

        // Initialize character counters after loading data
        setTimeout(() => {
            updateCharacterCount('profile-username', 'username-count', 20);
            updateCharacterCount('profile-bio', 'bio-count', 25);
        }, 100);

    } catch (error) {
        console.error('Unexpected error loading profile:', error);
        document.getElementById("profile-username").value = `User_${user.id.substring(0, 8)}`;
        document.getElementById("profile-bio").value = 'New disc golf player';
        document.getElementById("profile-picture-preview").src = "./images/user.png";
        document.getElementById("user-avatar").src = "./images/user.png";
        
        // Initialize character counters for fallback values
        setTimeout(() => {
            updateCharacterCount('profile-username', 'username-count', 20);
            updateCharacterCount('profile-bio', 'bio-count', 25);
        }, 100);
    }
}

// Update the saveProfile function
async function saveProfile() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const username = document.getElementById("profile-username").value.trim();
    const bio = document.getElementById("profile-bio").value.trim();

    // Enhanced validation with character limits
    if (!username || username.length < 2) {
        Swal.fire({
            icon: "error",
            title: "Invalid Username",
            text: "Username must be at least 2 characters long.",
        });
        return;
    }

    if (username.length > 20) {
        Swal.fire({
            icon: "error",
            title: "Username Too Long",
            text: "Username cannot exceed 20 characters.",
        });
        return;
    }

    if (bio.length > 25) {
        Swal.fire({
            icon: "error",
            title: "Bio Too Long",
            text: "Bio cannot exceed 25 characters.",
        });
        return;
    }

    // Check if username is already taken by another user
    const { data: existingUser, error: checkError } = await supabase
        .from("profiles")
        .select("id")
        .eq("username", username)
        .neq("id", user.id)
        .single();

    if (checkError && checkError.code !== 'PGRST116') {
        console.error('Error checking username:', checkError);
    } else if (existingUser) {
        Swal.fire({
            icon: "error",
            title: "Username Taken",
            text: "This username is already taken. Please choose another one.",
        });
        return;
    }

    // Rest of the function remains the same...
    try {
        let profileData = {
            id: user.id,
            username,
            bio,
            updated_at: new Date()
        };

        if (selectedProfilePicture) {
            profileData.profile_picture_base64 = selectedProfilePicture;
            document.getElementById("user-avatar").src = selectedProfilePicture;
            selectedProfilePicture = null;
        }

        const { error } = await supabase.from("profiles").upsert(profileData);

        if (error) {
            throw error;
        }

        Swal.fire({
            title: "Profile Saved!",
            text: "Your profile has been updated successfully.",
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

function updateCharacterCount(inputId, counterId, maxLength) {
    const input = document.getElementById(inputId);
    const counter = document.getElementById(counterId);
    
    if (!input || !counter) return;
    
    const currentLength = input.value.length;
    counter.textContent = `${currentLength}/${maxLength}`;
    
    // Change color based on remaining characters
    if (currentLength >= maxLength) {
        counter.className = 'absolute right-3 top-1/2 transform -translate-y-1/2 text-xs text-red-500 font-bold';
        if (inputId === 'profile-bio') {
            counter.className = 'absolute right-3 bottom-3 text-xs text-red-500 font-bold';
        }
    } else if (currentLength >= maxLength * 0.8) {
        counter.className = 'absolute right-3 top-1/2 transform -translate-y-1/2 text-xs text-orange-500 font-medium';
        if (inputId === 'profile-bio') {
            counter.className = 'absolute right-3 bottom-3 text-xs text-orange-500 font-medium';
        }
    } else {
        counter.className = 'absolute right-3 top-1/2 transform -translate-y-1/2 text-xs text-gray-500 font-medium';
        if (inputId === 'profile-bio') {
            counter.className = 'absolute right-3 bottom-3 text-xs text-gray-500 font-medium';
        }
    }
}

function togglePasswordVisibility() {
    const passwordInput = document.querySelector('.input-wrapper input[type="password"], .input-wrapper input[type="text"]');
    const toggleIcon = document.querySelector('.eye-icon');

    if (passwordInput && toggleIcon) {
        if (passwordInput.type === 'password') {
            passwordInput.type = 'text';
            toggleIcon.textContent = 'visibility';
        } else {
            passwordInput.type = 'password';
            toggleIcon.textContent = 'visibility_off';
        }
    }
}

// Auth mode switching
let currentAuthMode = 'login'; // 'login' or 'signup'

function switchToSignup() {
    currentAuthMode = 'signup';
    const formTitle = document.getElementById('form-title');
    const authButton = document.getElementById('auth-button');
    const switchText = document.getElementById('auth-switch-text');
    const forgotLink = document.getElementById('forgot-pass-link');

    formTitle.textContent = 'Sign Up';
    authButton.textContent = 'Create Account';
    switchText.innerHTML = 'Already have an account? <a href="#" onclick="switchToLogin(); return false;">Login</a>';
    forgotLink.style.display = 'none';
}

function switchToLogin() {
    currentAuthMode = 'login';
    const formTitle = document.getElementById('form-title');
    const authButton = document.getElementById('auth-button');
    const switchText = document.getElementById('auth-switch-text');
    const forgotLink = document.getElementById('forgot-pass-link');

    formTitle.textContent = 'Login with';
    authButton.textContent = 'Login';
    switchText.innerHTML = 'Don\'t have an account? <a href="#" onclick="switchToSignup(); return false;">Signup now</a>';
    forgotLink.style.display = 'block';
}

function handleAuth() {
    if (currentAuthMode === 'signup') {
        signUp();
    } else {
        signIn();
    }
}

function resetAppState() {
    // Reset sections
    document.querySelectorAll('.section').forEach(section => {
        section.classList.remove('active');
        section.classList.add('hidden');
    });
    
    // Reset weather widget
    const weatherWidget = document.getElementById('weather-widget');
    if (weatherWidget) {
        weatherWidget.classList.add('hidden');
        weatherWidget.classList.remove('flex');
    }
    
    // Reset profile picture
    document.getElementById('user-avatar').src = './images/user.png';
    document.getElementById('profile-picture-preview').src = './images/user.png';
    
    // Reset forms
    document.getElementById('login-email').value = '';
    document.getElementById('login-password').value = '';
    document.getElementById('profile-username').value = '';
    document.getElementById('profile-email').value = '';
    document.getElementById('profile-bio').value = '';
    
    // Reset course selection
    document.getElementById('course').value = '';
    
    // Reset scorecard
    document.getElementById('scorecard').style.display = 'none';
    
    // Reset global variables
    currentRound = null;
    coursesData = [];
    profilePictureCache = {};
    coursesCacheTime = null;
    selectedProfilePicture = null;
    
    // Clear content containers
    document.getElementById('courses-container').innerHTML = '';
    document.getElementById('history-list').innerHTML = '';
    document.getElementById('friends-list').innerHTML = '';
}

// Forgot password functionality
async function showForgotPassword() {
    const { value: email } = await Swal.fire({
        title: 'Reset Your Password',
        html: `
            <div style="text-align: left;">
                <p style="margin-bottom: 15px; color: #666;">Enter your email address and we'll send you a link to reset your password.</p>
            </div>
        `,
        input: 'email',
        inputPlaceholder: 'Enter your email address',
        inputValue: document.getElementById('login-email').value,
        showCancelButton: true,
        confirmButtonText: 'Send Reset Email',
        confirmButtonColor: '#667eea',
        cancelButtonColor: '#6c757d',
        inputValidator: (value) => {
            if (!value) {
                return 'Please enter your email address';
            }
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
                return 'Please enter a valid email address';
            }
        }
    });

    if (email) {
        try {
            const { error } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: `${window.location.origin}${window.location.pathname}`
            });

            if (error) {
                throw error;
            }

            Swal.fire({
                title: 'Reset Email Sent! 📧',
                html: `
                    <div style="text-align: left;">
                        <p>We've sent password reset instructions to:</p>
                        <p style="font-weight: bold; color: #667eea; margin: 15px 0;">${email}</p>
                        <p>Please check your email and follow the link to reset your password.</p>
                        <p style="font-size: 14px; color: #666; margin-top: 15px;">
                            <strong>Note:</strong> The reset link will expire in 1 hour for security.
                        </p>
                    </div>
                `,
                icon: 'success',
                confirmButtonColor: '#667eea',
                confirmButtonText: 'Got it!'
            });
        } catch (error) {
            Swal.fire({
                icon: 'error',
                title: 'Unable to Send Reset Email',
                text: error.message,
                confirmButtonColor: '#667eea'
            });
        }
    }
}

// Handle password reset from email link
async function handlePasswordReset() {
    const urlParams = new URLSearchParams(window.location.search);
    const access_token = urlParams.get('access_token');
    const refresh_token = urlParams.get('refresh_token');
    const type = urlParams.get('type');
    const error = urlParams.get('error');
    const error_description = urlParams.get('error_description');

    // Check for errors first (like expired links)
    if (error) {
        let title = 'Reset Link Error';
        let message = 'There was an error with your password reset link.';
        
        if (error === 'access_denied' || error_description?.includes('expired')) {
            title = 'Reset Link Expired ⏰';
            message = 'This password reset link has expired. Reset links are only valid for 1 hour for security reasons.';
        } else if (error_description?.includes('invalid')) {
            title = 'Invalid Reset Link';
            message = 'This password reset link is invalid or has already been used.';
        }

        Swal.fire({
            icon: 'error',
            title: title,
            html: `
                <div style="text-align: left;">
                    <p style="margin-bottom: 15px;">${message}</p>
                    <p style="font-weight: 600; color: #667eea;">Would you like to request a new password reset?</p>
                </div>
            `,
            showCancelButton: true,
            confirmButtonText: 'Send New Reset Email',
            cancelButtonText: 'Cancel',
            confirmButtonColor: '#667eea',
            cancelButtonColor: '#6c757d'
        }).then((result) => {
            // Clear URL parameters
            window.history.replaceState({}, document.title, window.location.pathname);
            
            if (result.isConfirmed) {
                // Open the forgot password dialog
                showForgotPassword();
            }
        });
        return;
    }

    if (type === 'recovery' && access_token && refresh_token) {
        try {
            // Set the session with the tokens from the URL
            const { data, error } = await supabase.auth.setSession({
                access_token,
                refresh_token
            });

            if (error) {
                throw error;
            }

            // Show password reset form
            await showNewPasswordForm();
        } catch (error) {
            console.error('Error handling password reset:', error);
            
            let title = 'Reset Link Error';
            let message = 'This password reset link is invalid or has expired. Please request a new one.';
            
            // Check for specific error types
            if (error.message?.includes('expired') || error.message?.includes('invalid_grant')) {
                title = 'Reset Link Expired ⏰';
                message = 'This password reset link has expired. Reset links are only valid for 1 hour for security reasons.';
            }
            
            Swal.fire({
                icon: 'error',
                title: title,
                html: `
                    <div style="text-align: left;">
                        <p style="margin-bottom: 15px;">${message}</p>
                        <p style="font-weight: 600; color: #667eea;">Would you like to request a new password reset?</p>
                    </div>
                `,
                showCancelButton: true,
                confirmButtonText: 'Send New Reset Email',
                cancelButtonText: 'Cancel',
                confirmButtonColor: '#667eea',
                cancelButtonColor: '#6c757d'
            }).then((result) => {
                // Clear URL parameters
                window.history.replaceState({}, document.title, window.location.pathname);
                
                if (result.isConfirmed) {
                    showForgotPassword();
                }
            });
        }
    }
}

// Show new password form
async function showNewPasswordForm() {
    const { value: formValues } = await Swal.fire({
        title: 'Set New Password',
        html: `
            <div style="text-align: left;">
                <div style="margin-bottom: 15px;">
                    <label style="display: block; margin-bottom: 5px; font-weight: 600;">New Password:</label>
                    <input type="password" id="new-password" class="swal2-input" placeholder="Enter new password" style="margin: 0;">
                </div>
                <div style="margin-bottom: 15px;">
                    <label style="display: block; margin-bottom: 5px; font-weight: 600;">Confirm Password:</label>
                    <input type="password" id="confirm-password" class="swal2-input" placeholder="Confirm new password" style="margin: 0;">
                </div>
                <div style="font-size: 14px; color: #666; margin-top: 10px;">
                    <p>Password must be at least 6 characters long.</p>
                </div>
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: 'Update Password',
        confirmButtonColor: '#667eea',
        cancelButtonColor: '#6c757d',
        focusConfirm: false,
        preConfirm: () => {
            const newPassword = document.getElementById('new-password').value;
            const confirmPassword = document.getElementById('confirm-password').value;
            
            if (!newPassword || !confirmPassword) {
                Swal.showValidationMessage('Please fill in both password fields');
                return false;
            }
            
            if (newPassword.length < 6) {
                Swal.showValidationMessage('Password must be at least 6 characters long');
                return false;
            }
            
            if (newPassword !== confirmPassword) {
                Swal.showValidationMessage('Passwords do not match');
                return false;
            }
            
            return { newPassword, confirmPassword };
        }
    });

    if (formValues) {
        try {
            const { error } = await supabase.auth.updateUser({
                password: formValues.newPassword
            });

            if (error) {
                throw error;
            }

            Swal.fire({
                title: 'Password Updated! 🎉',
                text: 'Your password has been successfully updated. You can now sign in with your new password.',
                icon: 'success',
                confirmButtonColor: '#667eea'
            }).then(() => {
                // Clear URL parameters and redirect to login
                window.history.replaceState({}, document.title, window.location.pathname);
                window.location.reload();
            });

        } catch (error) {
            console.error('Error updating password:', error);
            Swal.fire({
                icon: 'error',
                title: 'Error Updating Password',
                text: error.message,
                confirmButtonColor: '#667eea'
            });
        }
    }
}

// Settings page functions
function showSettings() {
    // Hide the profile content div
    const profileContent = document.getElementById('profile').querySelector('.space-y-4');
    if (profileContent) {
        profileContent.style.display = 'none';
    }
    
    // Hide the profile header (the one with "Your Profile" and settings button)
    const profileHeader = document.getElementById('profile').querySelector('.flex.items-center.justify-between.mb-6');
    if (profileHeader) {
        profileHeader.style.display = 'none';
    }
    
    // Show the settings page
    document.getElementById('settings-page').classList.remove('hidden');
    
    // Initialize settings toggles with current values
    document.getElementById('auto-location-toggle').checked = !!locationUpdateInterval;
    document.getElementById('score-display-toggle').checked = !showScoreDifference;
    
    updateLocationStatus();
}

function showProfile() {
    // Hide the settings page
    document.getElementById('settings-page').classList.add('hidden');
    
    // Show the profile header
    const profileHeader = document.getElementById('profile').querySelector('.flex.items-center.justify-between.mb-6');
    if (profileHeader) {
        profileHeader.style.display = 'flex';
    }
    
    // Show the profile content
    const profileContent = document.getElementById('profile').querySelector('.space-y-4');
    if (profileContent) {
        profileContent.style.display = 'block';
    }
}

function toggleAutoLocation(checkbox) {
    if (checkbox.checked) {
        startLocationUpdates();
        Swal.fire({
            title: "Auto-location Enabled",
            text: "Your location will be updated every 5 minutes",
            icon: "success",
            timer: 2000,
            showConfirmButton: false
        });
    } else {
        stopLocationUpdates();
        Swal.fire({
            title: "Auto-location Disabled", 
            text: "Location will only update manually",
            icon: "info",
            timer: 2000,
            showConfirmButton: false
        });
    }
    updateLocationStatus();
}

function toggleScoreDisplayGlobal(checkbox) {
    showScoreDifference = !checkbox.checked;
    
    // Update all score display toggles on the page
    document.querySelectorAll('.switch input').forEach(input => {
        if (input.id !== 'score-display-toggle' && input.id !== 'auto-location-toggle') {
            input.checked = !showScoreDifference;
        }
    });
    
    // Refresh current displays if on history or progress
    const currentSection = document.querySelector('.section:not(.hidden)');
    if (currentSection) {
        if (currentSection.id === 'history') {
            loadHistory();
        } else if (currentSection.id === 'progress') {
            updateProgress();
        }
    }
    
    Swal.fire({
        title: showScoreDifference ? "Showing Score Difference" : "Showing Total Scores",
        text: showScoreDifference ? "Scores now display as ±Par" : "Scores now display as total strokes",
        icon: "success",
        timer: 2000,
        showConfirmButton: false
    });
}

async function refreshLocationManually() {
    const button = event.target;
    const originalText = button.innerHTML;
    button.innerHTML = '🔄 Getting accurate location...';
    button.disabled = true;
    
    try {
        // Get high-accuracy location
        const freshLocation = await getHighAccuracyLocation();
        if (freshLocation) {
            currentUserLocation = freshLocation;
            lastLocationUpdate = Date.now();
            
            // Save to Supabase with accuracy
            await saveUserLocationToSupabase(
                freshLocation.latitude, 
                freshLocation.longitude, 
                freshLocation.accuracy
            );
            
            // Update courses
            coursesData.forEach(course => {
                if (course.coordinates) {
                    try {
                        const [lat, lon] = course.coordinates.split(',').map(Number);
                        course.distance = calculateDistance(
                            freshLocation.latitude, 
                            freshLocation.longitude, 
                            lat, 
                            lon
                        );
                    } catch (error) {
                        console.warn(`Invalid coordinates for course ${course.name}`);
                    }
                }
            });
            
            // Re-sort and display
            sortCourses(courseSortBy);
            displayCourses();
        }
        
        updateLocationStatus();
        
        const accuracyText = freshLocation?.accuracy ? 
            ` (±${Math.round(freshLocation.accuracy)}m accuracy)` : '';
        
        Swal.fire({
            title: "Location Updated",
            text: `Course distances have been refreshed${accuracyText}`,
            icon: "success",
            timer: 3000,
            showConfirmButton: false
        });
    } catch (error) {
        Swal.fire({
            title: "Location Update Failed",
            text: "Could not get accurate location",
            icon: "error",
            timer: 2000,
            showConfirmButton: false
        });
    } finally {
        button.innerHTML = originalText;
        button.disabled = false;
    }
}

function clearCacheData() {
    Swal.fire({
        title: 'Clear Cache Data?',
        text: 'This will clear cached course and profile data. The app will reload fresh data.',
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#f97316',
        cancelButtonColor: '#6c757d',
        confirmButtonText: 'Yes, clear cache'
    }).then((result) => {
        if (result.isConfirmed) {
            // Clear caches
            profilePictureCache = {};
            coursesCacheTime = null;
            coursesData = [];
            
            // Clear any browser storage if used
            try {
                localStorage.removeItem('newRoundExpanded');
            } catch (error) {
                console.log('No localStorage to clear');
            }
            
            // Reload data
            loadCourses();
            
            Swal.fire({
                title: "Cache Cleared",
                text: "Fresh data has been loaded",
                icon: "success",
                timer: 2000,
                showConfirmButton: false
            });
        }
    });
}

function updateLocationStatus() {
    const statusElement = document.getElementById('location-status');
    if (!statusElement) return;
    
    if (locationUpdateInterval) {
        const nextUpdate = lastLocationUpdate ? 
            new Date(lastLocationUpdate + LOCATION_UPDATE_INTERVAL).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) :
            'Soon';
        statusElement.textContent = `Auto-updating enabled • Next update: ${nextUpdate}`;
        statusElement.className = 'text-xs text-green-600';
    } else {
        statusElement.textContent = 'Auto-updating disabled • Manual refresh only';
        statusElement.className = 'text-xs text-gray-500';
    }
}


// Add to window exports
window.updatePlayerScoreDisplay = updatePlayerScoreDisplay;
window.setScoreToPar = setScoreToPar;
window.handlePasswordReset = handlePasswordReset;
window.showSettings = showSettings;
window.showProfile = showProfile;
window.toggleAutoLocation = toggleAutoLocation;
window.toggleScoreDisplayGlobal = toggleScoreDisplayGlobal;
window.refreshLocationManually = refreshLocationManually;
window.clearCacheData = clearCacheData;
window.updateLocationStatus = updateLocationStatus;
window.togglePasswordVisibility = togglePasswordVisibility;
window.switchToSignup = switchToSignup;
window.switchToLogin = switchToLogin;
window.handleAuth = handleAuth;
window.showForgotPassword = showForgotPassword;
window.applyCrop = applyCrop;
window.refreshLocationFromBadge = refreshLocationFromBadge;
window.refreshLocationFromButton = refreshLocationFromButton;
window.showSection = showSection;
window.startRound = startRound;
window.updateScore = updateScore;
window.getHighAccuracyLocation = getHighAccuracyLocation;
window.updateUserLocationSmart = updateUserLocationSmart;
window.isLocationSignificantlyDifferent = isLocationSignificantlyDifferent;
window.signOut = signOut;
window.signUp = signUp;
window.signIn = signIn;
window.signInWithGoogle = signInWithGoogle;
window.saveProfile = saveProfile;
window.previewProfilePicture = previewProfilePicture
window.searchUsers = searchUsers;
window.clearSearchResults = clearSearchResults;
window.sendFriendRequest = sendFriendRequest;
window.diagnoseLocationIssues = diagnoseLocationIssues;
window.runLocationDiagnostics = runLocationDiagnostics;
window.removeFriend = removeFriend;
window.addFriendToRound = addFriendToRound;
window.showFriendDetails = showFriendDetails;
window.loadFriends = loadFriends;
window.toggleDateGroup = toggleDateGroup;
window.toggleProgressFilter = toggleProgressFilter;
window.setProgressFilter = setProgressFilter;
window.toggleRoundItem = toggleRoundItem;
window.loadRoundScorecard = loadRoundScorecard;
window.toggleScoreDisplay = toggleScoreDisplay;
window.loadCourses = loadCourses;
window.loadProfile = loadProfile;
window.saveProfile = saveProfile;
window.getPositionText = getPositionText;
window.getPositionBadgeColor = getPositionBadgeColor;
window.loadCurrentRound = loadCurrentRound;
window.startRound = startRound;
window.closeCroppieModal = closeCroppieModal;
window.updateScore = updateScore;
window.finishRound = finishRound;
window.checkForIncompleteRounds = checkForIncompleteRounds;
window.toggleScoreDisplayAndRefresh = toggleScoreDisplayAndRefresh;
window.updateScorecardDisplay = updateScorecardDisplay;
window.calculateDistance = calculateDistance;
window.getUserLocation = getUserLocation;
window.formatDistance = formatDistance;
window.addGuestPlayerToRound = addGuestPlayerToRound;
window.deleteRound = deleteRound;
window.updateProgress = updateProgress;
window.loadHistory = loadHistory;
window.changeHole = changeHole;
window.goToHole = goToHole;
window.toggleFriendFavorite = toggleFriendFavorite;
window.deleteCurrentRound = deleteCurrentRound;
window.deleteRoundFromDetails = deleteRoundFromDetails;
window.copyRoundToText = copyRoundToText;
window.toggleNewRoundSection = toggleNewRoundSection;
window.autoCollapseNewRound = autoCollapseNewRound;
window.restoreNewRoundState = restoreNewRoundState;
window.sortCourses = sortCourses;
window.displayCourses = displayCourses;
window.showCanvasConfetti = showCanvasConfetti;
window.showSectionWithLoadingProtection = showSectionWithLoadingProtection;
window.showLoadingScreen = showLoadingScreen;
window.hideLoadingScreen = hideLoadingScreen;
window.updateCharacterCount = updateCharacterCount;
window.refreshLocation = refreshLocation;
window.saveUserLocationToSupabase = saveUserLocationToSupabase;
window.getUserLocationFromSupabase = getUserLocationFromSupabase;
window.getUserLocationWithCache = getUserLocationWithCache;

window.addEventListener("DOMContentLoaded", async () => {
    // Check for password reset parameters in both search and hash
    const urlParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    
    if (urlParams.get('type') === 'recovery' || hashParams.get('type') === 'recovery' || 
        urlParams.has('error') || hashParams.has('error') || hashParams.has('error_code')) {
        await handlePasswordReset();
        return;
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
        console.log("Restored session:", session.user.email);
        loginSuccessful();
        showLoadingScreen(); // Show loading screen
        isAppLoading = true;
        
        // Set a timeout to prevent infinite loading
        loadingTimeout = setTimeout(() => {
            console.warn('Loading timeout reached, forcing app to show');
            isAppLoading = false;
            hideLoadingScreen();
            showSection('new-round');
        }, 10000); // 10 second timeout
        
        try {
            // Load profile, courses, and weather in parallel with individual error handling
            await Promise.allSettled([
                loadProfile().catch(err => console.error('Profile loading failed:', err)),
                loadCourses().catch(err => console.error('Courses loading failed:', err)),
                loadWeather().catch(err => console.error('Weather loading failed:', err))
            ]);
            
            await loadCurrentRound().catch(err => console.error('Current round loading failed:', err));
            
            // Clear timeout since we completed successfully
            if (loadingTimeout) {
                clearTimeout(loadingTimeout);
                loadingTimeout = null;
            }
            
            // Mark loading as complete
            isAppLoading = false;
            hideLoadingScreen();
            showSection('new-round'); // Only call once
            
            setTimeout(() => {
                restoreNewRoundState();
            }, 100);
            
        } catch (error) {
            console.error('Error during app initialization:', error);
            // Clear timeout and show app anyway
            if (loadingTimeout) {
                clearTimeout(loadingTimeout);
                loadingTimeout = null;
            }
            isAppLoading = false;
            hideLoadingScreen();
            showSection('new-round');
        }
        
    } else {
        console.log("User is not logged in");
        isAppLoading = false; // Not loading if not logged in
    }
});

window.addEventListener("scroll", () => {
    const currentScroll = window.scrollY;
    const header = document.getElementById("main-header");

    if (currentScroll < fadeStartDistance) {
        // Fully visible
        currentHeaderOpacity = 0.95;
    } else if (currentScroll > fadeCompleteDistance) {
        // Fully transparent
        currentHeaderOpacity = 0;
    } else {
        // Linear fade between start and complete distances
        const fadeProgress = (currentScroll - fadeStartDistance) / (fadeCompleteDistance - fadeStartDistance);
        currentHeaderOpacity = 0.95 * (1 - fadeProgress);
    }

    // Fade background
    header.style.backgroundColor = `rgba(255, 255, 255, ${currentHeaderOpacity})`;
    header.style.backdropFilter = `blur(${currentHeaderOpacity * 12}px)`;
    
    // Fade all content inside the header
    header.style.opacity = currentHeaderOpacity / 0.95; // Normalize to 0-1 range
});

let adminMode = false;

// Enter Admin Mode
document.addEventListener('keydown', function(event) {
    if (event.ctrlKey && event.shiftKey && (event.key === 'l' || event.key === 'L')) {
        adminMode = !adminMode;
        console.log(`🔑 Admin Mode: ${adminMode}`);
    }
});

// Confetti with Ctrl + G
document.addEventListener('keydown', function(event) {
    if (adminMode && (event.key === 'g' || event.key === 'G')) {
        console.log('🎉 Confetti triggered by Ctrl+G!');
        showCanvasConfetti();
    }
});

// Rain debug with Ctrl + R
document.addEventListener('keydown', function(event) {
    if (adminMode && (event.key === 'r' || event.key === 'R')) {
        console.log('🌧️ Rain debug triggered by Ctrl+R!');
        toggleDebugRain();
    }
});

document.querySelectorAll('.bottom-navigation-bar .nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    // remove active from all buttons
    document.querySelectorAll('.bottom-navigation-bar .nav-btn')
            .forEach(b => b.classList.remove('active'));
    // add active to the clicked one
    btn.classList.add('active');
  });
});
