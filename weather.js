// Import supabase and coursesData from the main script
import { supabase, coursesData, getUserLocationWithCache, displayCourses } from './script.js';

const weatherCache = new Map();
let weatherRefreshInterval = null;

// Weather configuration
const WEATHER_CONFIG = {
    API_KEY: 'a3e903daa8e24ef0c7b9d836686bd7fb', // Get from openweathermap.org
    CACHE_DURATION: 30 * 60 * 1000, // 30 minutes
    LOCATION_RADIUS: 500, // 500 meters
    BACKUP_APIS: [
        'openweathermap', // Primary
        'weatherapi',     // Backup 1
        'open-meteo'      // Backup 2 (free)
    ]
};

function startWeatherAutoRefresh() {
    // Clear any existing interval
    if (weatherRefreshInterval) {
        clearInterval(weatherRefreshInterval);
    }
    
    // Refresh weather every 5 minutes
    weatherRefreshInterval = setInterval(async () => {
        console.log('Auto-refreshing weather...');
        
        // Refresh widget weather
        await loadWeather();
        
        // Refresh course weather if user is on new-round section
        const newRoundSection = document.getElementById('new-round');
        if (newRoundSection && !newRoundSection.classList.contains('hidden')) {
            await loadWeatherForAllCourses();
            displayCourses();
        }
    }, 5 * 60 * 1000); // 5 minutes
    
    console.log('Weather auto-refresh started (every 5 minutes)');
}

function stopWeatherAutoRefresh() {
    if (weatherRefreshInterval) {
        clearInterval(weatherRefreshInterval);
        weatherRefreshInterval = null;
        console.log('Weather auto-refresh stopped');
    }
}

// Update the fetchWeatherFromAPI function to handle missing keys
async function fetchWeatherFromAPI(lat, lon, apiType = 'open-meteo') {
    try {
        let url, response, data;
        
        switch (apiType) {
            case 'openweathermap':
                if (!WEATHER_CONFIG.API_KEY) {
                    throw new Error('OpenWeatherMap API key not configured');
                }
                url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${WEATHER_CONFIG.API_KEY}&units=metric`;
                response = await fetch(url);
                if (!response.ok) throw new Error(`OpenWeatherMap API error: ${response.status}`);
                data = await response.json();
                return {
                    temperature: Math.round(data.main.temp),
                    description: data.weather[0].description,
                    main: data.weather[0].main,
                    humidity: data.main.humidity,
                    pressure: data.main.pressure,
                    windSpeed: data.wind?.speed || 0,
                    windDirection: data.wind?.deg || 270, // ADD THIS LINE
                    visibility: data.visibility || null
                };
                
            case 'weatherapi':
                if (!WEATHER_CONFIG.WEATHER_API_KEY) {
                    throw new Error('WeatherAPI key not configured');
                }
                url = `https://api.weatherapi.com/v1/current.json?key=${WEATHER_CONFIG.WEATHER_API_KEY}&q=${lat},${lon}`;
                response = await fetch(url);
                if (!response.ok) throw new Error(`WeatherAPI error: ${response.status}`);
                data = await response.json();
                return {
                    temperature: Math.round(data.current.temp_c),
                    description: data.current.condition.text.toLowerCase(),
                    main: data.current.condition.text,
                    humidity: data.current.humidity,
                    pressure: data.current.pressure_mb,
                    windSpeed: data.current.wind_kph / 3.6,
                    windDirection: data.current.wind_degree || 270, // ADD THIS LINE
                    visibility: data.current.vis_km * 1000
                };
                
            case 'open-meteo':
                url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&hourly=temperature_2m,relativehumidity_2m,precipitation,weathercode&timezone=auto`;
                response = await fetch(url);
                if (!response.ok) throw new Error(`Open-Meteo API error: ${response.status}`);
                data = await response.json();
                const current = data.current_weather;
                
                // Enhanced weather data extraction
                const hourlyData = data.hourly;
                const currentHour = new Date().getHours();

                const windData = extractWindDataFromAPI(data, 'open-meteo');
                
                return {
                    temperature: Math.round(current.temperature),
                    description: getWeatherDescription(current.weathercode),
                    main: getWeatherMain(current.weathercode),
                    humidity: hourlyData?.relativehumidity_2m?.[currentHour] || null,
                    pressure: null,
                    windSpeed: windData.windSpeed,
                    windDirection: windData.windDirection,
                    visibility: null,
                    precipitation: hourlyData?.precipitation?.[currentHour] || 0
                };
                
            default:
                throw new Error(`Unknown API type: ${apiType}`);
        }
    } catch (error) {
        console.error(`Error fetching weather from ${apiType}:`, error);
        throw error;
    }
}

async function getWeatherWithFallback(lat, lon) {
    for (const apiType of WEATHER_CONFIG.BACKUP_APIS) {
        try {
            const weatherData = await fetchWeatherFromAPI(lat, lon, apiType);
            console.log(`Successfully fetched weather from ${apiType}`);
            return weatherData;
        } catch (error) {
            console.warn(`Failed to fetch from ${apiType}, trying next...`);
            continue;
        }
    }
    throw new Error('All weather APIs failed');
}

// Check if location is within radius of cached weather
function isWithinRadius(lat1, lon1, lat2, lon2, radiusMeters = WEATHER_CONFIG.LOCATION_RADIUS) {
    const R = 6371000; // Earth's radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distance = R * c;
    return distance <= radiusMeters;
}

// Enhanced weather descriptions for Open-Meteo codes
function getWeatherMain(weathercode) {
    if (weathercode >= 61 && weathercode <= 67) return 'Rain';
    if (weathercode >= 71 && weathercode <= 77) return 'Snow';
    if (weathercode >= 80 && weathercode <= 82) return 'Rain';
    if (weathercode >= 95 && weathercode <= 99) return 'Thunderstorm';
    if (weathercode >= 45 && weathercode <= 48) return 'Fog';
    if (weathercode >= 51 && weathercode <= 57) return 'Drizzle';
    if (weathercode <= 3) return 'Clear';
    return 'Clouds';
}

async function cleanupOldWeatherData() {
    const cutoffDate = new Date(Date.now() - 60 * 60 * 1000); // 1 hour old
    
    try {
        const { error } = await supabase
            .from('courses')
            .update({
                last_weather_update: null,
                temperature: null,
                description: null,
                humidity: null,
                wind_speed: null,
                wind_direction: null,
                visibility: null,
                is_raining: null
            })
            .lt('last_weather_update', cutoffDate.toISOString());
        
        if (error) {
            console.error('Error cleaning up old weather data:', error);
        } else {
            console.log('Cleaned up weather data older than 1 hour');
        }
    } catch (error) {
        console.error('Error cleaning up weather data:', error);
    }
}

async function loadWeatherForAllCourses() {
    addRainAnimationStyles();
    
    try {
        // First load any cached weather data
        await loadCachedWeatherData();
        
        // Clean up old data
        await cleanupOldWeatherData();
        
        // Process courses in batches to avoid rate limiting
        const batchSize = 5;
        for (let i = 0; i < coursesData.length; i += batchSize) {
            const batch = coursesData.slice(i, i + batchSize);
            
            await Promise.all(batch.map(async (course, batchIndex) => {
                const globalIndex = i + batchIndex;
                if (course.coordinates) {
                    const weather = await getWeatherForCourse(course);
                    if (weather) {
                        coursesData[globalIndex].weather = weather;
                        console.log(`Weather loaded for ${course.name}: isRaining=${weather.isRaining}`);
                    }
                }
            }));
            
            // Small delay between batches
            if (i + batchSize < coursesData.length) {
                await new Promise(resolve => setTimeout(resolve, 200));
            }
        }
        
        // Display courses with weather data
        displayCourses();
        
        // Apply rain animations after courses are displayed
        setTimeout(() => {
            applyRainAnimationsToAllCourses();
        }, 100);
        
    } catch (error) {
        console.error('Error loading weather for courses:', error);
        displayCourses(); // Fallback to display without weather
    }
}

function applyRainAnimationsToAllCourses() {
    console.log('Applying rain animations to course cards...');
    
    coursesData.forEach(course => {
        if (course.weather && course.weather.isRaining) {
            const courseCard = document.querySelector(`[data-course-id="${course.id}"]`);
            if (courseCard && !courseCard.classList.contains('has-rain')) {
                console.log(`Adding rain animation to ${course.name}`);
                createRainAnimation(courseCard, course.weather);
            }
        }
    });
}

function toggleDebugRain() {
    if (!coursesData || coursesData.length === 0) {
        console.log('No courses available for rain debug');
        return;
    }
    
    const firstCourse = coursesData[0];
    
    // Toggle rain state
    if (!firstCourse.weather) {
        firstCourse.weather = {};
    }
    
    firstCourse.weather.isRaining = !firstCourse.weather.isRaining;
    
    console.log(`Rain debug: ${firstCourse.weather.isRaining ? 'ON' : 'OFF'} for ${firstCourse.name}`);
    
    // Find the first course card and apply/remove rain immediately
    setTimeout(() => {
        const firstCard = document.querySelector('.course-card');
        if (firstCard) {
            if (firstCourse.weather.isRaining) {
                if (!firstCard.classList.contains('has-rain')) {
                    console.log('Adding rain to first course card');
                    createRainAnimation(firstCard);
                }
            } else {
                if (firstCard.classList.contains('has-rain')) {
                    console.log('Removing rain from first course card');
                    stopRainAnimation(firstCard);
                }
            }
        }
    }, 50);
}

// Add this improved debug function
function debugRainSystem() {
    console.log('=== Rain System Debug ===');
    
    const rainCards = document.querySelectorAll('.course-card.has-rain');
    console.log(`Rain cards found: ${rainCards.length}`);
    
    const allCards = document.querySelectorAll('.course-card');
    console.log(`Total course cards: ${allCards.length}`);
    
    rainCards.forEach((card, index) => {
        console.log(`Rain card ${index}:`, {
            hasRainClass: card.classList.contains('has-rain'),
            inDOM: document.contains(card),
            hasCanvas: !!card.querySelector('canvas'),
            cardSize: `${card.offsetWidth}x${card.offsetHeight}`
        });
    });
    
    // Check course data
    const rainingCourses = coursesData.filter(c => c.weather?.isRaining);
    console.log(`Courses with rain data: ${rainingCourses.length}`, rainingCourses.map(c => c.name));
}


function forceRainOnFirstCourse() {
    if (!coursesData || coursesData.length === 0) {
        console.log('No courses available');
        return;
    }
    
    const firstCourse = coursesData[0];
    firstCourse.weather = {
        isRaining: true,
        temperature: 12,
        description: 'moderate rain',
        main: 'Rain',
        windSpeed: 3.5, // Add wind speed
        windDirection: 270 // Add wind direction (west wind)
    };
    
    console.log(`Forced rain with wind on: ${firstCourse.name}`);
    displayCourses();
}

// Add this helper function to extract wind data from API responses
function extractWindDataFromAPI(apiData, apiType) {
    let windSpeed = 0;
    let windDirection = 270; // Default to west wind
    
    switch (apiType) {
        case 'openweathermap':
            windSpeed = apiData.wind?.speed || 0;
            windDirection = apiData.wind?.deg || 270;
            break;
        case 'weatherapi':
            windSpeed = apiData.current.wind_kph / 3.6; // Convert to m/s
            windDirection = apiData.current.wind_degree || 270;
            break;
        case 'open-meteo':
            windSpeed = apiData.current_weather.windspeed / 3.6; // Convert to m/s
            windDirection = apiData.current_weather.winddirection || 270;
            break;
    }
    
    return { windSpeed, windDirection };
}

function getWeatherEmoji(weatherMain, temperature) {
    const now = new Date();
    const hour = now.getHours();
    const isDay = hour >= 6 && hour < 20; // 6 AM to 8 PM is considered day
    
    // Check weather conditions first - prioritize precipitation over day/night
    switch (weatherMain?.toLowerCase()) {
        case 'rain':
        case 'light rain':
        case 'moderate rain':
        case 'heavy rain':
        case 'shower':
        case 'showers':
            return '🌧️';
        case 'drizzle':
        case 'light drizzle':
        case 'mist':
        case 'fog':
        case 'foggy':
            return '🌦️';
        case 'thunderstorm':
        case 'storm':
            return '⛈️';
        case 'snow':
        case 'light snow':
        case 'heavy snow':
            return '❄️';
        case 'clouds':
        case 'cloudy':
        case 'overcast':
            return isDay ? '☁️' : '☁️';
        case 'partly cloudy':
        case 'partly sunny':
            return isDay ? '⛅' : '🌙';
        case 'clear':
        case 'sunny':
            return isDay ? '☀️' : '🌙';
        case 'haze':
        case 'hazy':
            return '🌫️';
        case 'dust':
        case 'sand':
            return '🌪️';
        default:
            return isDay ? '🌤️' : '🌙';
    }
}

async function loadWeather() {
    const weatherWidget = document.getElementsByClassName('weather-widget');
    const weatherIcon = document.getElementsByClassName('weather-icon');
    const weatherTemp = document.getElementsByClassName('weather-temperature');
    
    try {
        console.log('Fetching fresh weather for widget...');
        const location = await getUserLocation();
        if (!location) {
            weatherWidget.classList.add('hidden');
            return;
        }

        // FORCE fresh weather fetch for widget (no cache)
        const apiWeatherData = await getWeatherWithFallback(location.latitude, location.longitude);
        
        if (!apiWeatherData) {
            weatherWidget.classList.add('hidden');
            return;
        }
        
        const weather = {
            temperature: apiWeatherData.temperature,
            description: apiWeatherData.description.toLowerCase(),
            main: apiWeatherData.main,
            humidity: apiWeatherData.humidity,
            pressure: apiWeatherData.pressure,
            windSpeed: apiWeatherData.windSpeed,
            windDirection: apiWeatherData.windDirection,
            visibility: apiWeatherData.visibility,
            isRaining: isRainyWeather(
                apiWeatherData.description.toLowerCase(), 
                apiWeatherData.main.toLowerCase(),
                apiWeatherData.precipitation || 0
            )
        };
        
<<<<<<< Updated upstream
        weatherIcon.textContent = 'sun';
        weatherTemp.textContent = `${weather.temperature}°C`;
=======
        // Stop loading animation
        if (weatherIcon) {
            weatherIcon.style.animation = '';
        }
        
        // Update UI with fresh data
        const emoji = getWeatherEmoji(weather.main, weather.temperature);
        
        weatherIcon.textContent = emoji;
        weatherTemp.textContent = `${weather.temperature}°C`;
        //weatherDesc.textContent = weather.description.charAt(0).toUpperCase() + weather.description.slice(1);
        
        // Update widget styling based on weather
        if (weather.isRaining) {
            weatherWidget.className = 'flex items-center gap-2 bg-blue-100/80 backdrop-blur-sm px-3 py-2 rounded-lg border border-blue-200/50 shadow-sm cursor-pointer transition-all duration-200 hover:bg-blue-200/80';
            weatherTemp.className = 'font-semibold text-blue-800';
            //weatherDesc.className = 'text-xs text-blue-700';
        } else {
            weatherWidget.className = 'flex items-center gap-2 bg-white/80 backdrop-blur-sm px-3 py-2 rounded-lg border border-gray-200/50 shadow-sm cursor-pointer transition-all duration-200 hover:bg-gray-100/80';
            weatherTemp.className = 'font-semibold text-gray-800';
            //weatherDesc.className = 'text-xs text-gray-700';
        }
>>>>>>> Stashed changes
        
        // Enhanced tooltip with weather details
        const now = new Date();
        const timeString = now.toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit',
            hour12: false 
        });
        const accuracy = location.accuracy ? ` (±${Math.round(location.accuracy)}m)` : '';
        
        let tooltipDetails = `${weather.description.charAt(0).toUpperCase() + weather.description.slice(1)}`;
        if (weather.humidity) tooltipDetails += `\nHumidity: ${weather.humidity}%`;
        if (weather.windSpeed) tooltipDetails += `\nWind: ${Math.round(weather.windSpeed * 3.6)} km/h`;
        tooltipDetails += `\nLast updated: ${timeString}${accuracy} • Fresh\nClick to refresh`;
        
        weatherWidget.title = tooltipDetails;
        
        // Show the widget with fade-in effect
        weatherWidget.classList.remove('hidden');
        weatherWidget.style.opacity = '0';
        weatherWidget.style.transform = 'translateY(-10px)';
        
        setTimeout(() => {
            weatherWidget.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
            weatherWidget.style.opacity = '1';
            weatherWidget.style.transform = 'translateY(0)';
        }, 50);
        
        // Brief success indication
        const originalIcon = weatherIcon.textContent;
        weatherIcon.textContent = '✨'; // Always show fresh indicator
        setTimeout(() => {
            weatherIcon.textContent = originalIcon;
        }, 1200);
        
        console.log(`Fresh weather loaded for widget: ${weather.temperature}°C, ${weather.description}`);
        
    } catch (error) {
        console.error('Error loading weather:', error);
        
        // Show error state briefly before hiding
        if (weatherIcon) {
            weatherIcon.style.animation = '';
            weatherIcon.textContent = '⚠️';
            weatherTemp.textContent = 'Error';
            //weatherDesc.textContent = 'Weather unavailable';
            
            setTimeout(() => {
                weatherWidget.classList.add('hidden');
            }, 2000);
        } else {
            weatherWidget.classList.add('hidden');
        }
    }
}

async function getWeatherForCourse(course) {
    if (!course.coordinates) {
        return null;
    }
    
    const [lat, lon] = course.coordinates.split(',').map(Number);
    if (!lat || !lon) {
        return null;
    }
    
    try {
        // Check if we have recent cached weather (reduce cache time to 5 minutes)
        const COURSE_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes instead of 30
        
        const { data: recentWeather, error: cacheError } = await supabase
            .from('courses')
            .select('last_weather_update, temperature, description, humidity, wind_speed, wind_direction, visibility, is_raining')
            .eq('id', course.id)
            .single();
        
        if (!cacheError && recentWeather && recentWeather.last_weather_update) {
            const cacheAge = Date.now() - new Date(recentWeather.last_weather_update).getTime();
            console.log(`Cached weather for ${course.name} is ${Math.round(cacheAge / 1000 / 60)}min old`);
            
            if (cacheAge < COURSE_CACHE_DURATION) {
                console.log(`Using cached weather for ${course.name}`);
                return {
                    temperature: recentWeather.temperature,
                    description: recentWeather.description,
                    main: recentWeather.description,
                    humidity: recentWeather.humidity,
                    windSpeed: recentWeather.wind_speed,
                    windDirection: recentWeather.wind_direction,
                    visibility: recentWeather.visibility,
                    isRaining: recentWeather.is_raining
                };
            } else {
                await cleanupOldWeatherData();
                console.log(`Cached weather for ${course.name} is stale (${Math.round(cacheAge / 1000 / 60)}min old)`);
            }
        }
        
        // Fetch fresh weather if cache is stale or missing
        console.log(`Fetching fresh weather from API for ${course.name}`);
        const apiWeatherData = await getWeatherWithFallback(lat, lon);
        
        const processedData = {
            temperature: apiWeatherData.temperature,
            description: apiWeatherData.description.toLowerCase(),
            main: apiWeatherData.main,
            humidity: apiWeatherData.humidity,
            pressure: apiWeatherData.pressure,
            windSpeed: apiWeatherData.windSpeed,
            windDirection: apiWeatherData.windDirection,
            visibility: apiWeatherData.visibility,
            isRaining: isRainyWeather(
                apiWeatherData.description.toLowerCase(), 
                apiWeatherData.main.toLowerCase(),
                apiWeatherData.precipitation || 0
            )
        };

        // Always update database with fresh data
        const { error: updateError } = await supabase
            .from('courses')
            .update({
                last_weather_update: new Date().toISOString(),
                temperature: processedData.temperature,
                description: processedData.description,
                humidity: processedData.humidity,
                wind_speed: processedData.windSpeed,
                wind_direction: processedData.windDirection,
                visibility: processedData.visibility,
                is_raining: processedData.isRaining
            })
            .eq('id', course.id);
        
        if (updateError) {
            console.error('Error updating weather in database:', updateError);
        } else {
            console.log(`Weather data saved to database for course ${course.id}`);
        }
        
        console.log(`Weather loaded for ${course.name}: isRaining=${processedData.isRaining}`);
        return processedData;
        
    } catch (error) {
        console.error('Error getting weather for course:', error);
        return null;
    }
}

async function loadCachedWeatherData() {
    try {
        const { data: coursesWithWeather, error } = await supabase
            .from("courses")
            .select("id, last_weather_update, temperature, description, humidity, wind_speed, wind_direction, visibility, is_raining");
        
        if (error) {
            console.error("Error loading cached weather data:", error);
            return;
        }

        let cachedCount = 0;
        
        // Update coursesData with valid cached weather
        coursesWithWeather.forEach(courseWeather => {
            const course = coursesData.find(c => c.id === courseWeather.id);
            if (course && courseWeather.last_weather_update) {
                // Check if weather data is still valid (less than 5 minutes old)
                const weatherAge = Date.now() - new Date(courseWeather.last_weather_update).getTime();
                console.log("The weatherage is", weatherAge);
                if (weatherAge < 5 * 60 * 1000) { // 5 minutes
                    // Update the course object with cached weather data
                    course.last_weather_update = courseWeather.last_weather_update;
                    course.temperature = courseWeather.temperature;
                    course.description = courseWeather.description;
                    course.humidity = courseWeather.humidity;
                    course.wind_speed = courseWeather.wind_speed;
                    course.wind_direction = courseWeather.wind_direction;
                    course.visibility = courseWeather.visibility;
                    course.is_raining = courseWeather.is_raining;
                    
                    // Set weather object for compatibility
                    course.weather = {
                        temperature: courseWeather.temperature,
                        description: courseWeather.description,
                        main: courseWeather.description,
                        humidity: courseWeather.humidity,
                        windSpeed: courseWeather.wind_speed,
                        windDirection: courseWeather.wind_direction,
                        visibility: courseWeather.visibility,
                        isRaining: courseWeather.is_raining
                    };
                    
                    cachedCount++;
                    console.log(`Using cached weather for ${course.name} (${Math.round(weatherAge / 1000)}s old)`);
                } else {
                    getWeatherForCourse(course);
                    console.log(`Cached weather for ${course.name} is stale (${Math.round(weatherAge / 1000 / 60)}min old)`);
                }
            }
        });
        
        console.log(`Loaded ${cachedCount} courses with valid cached weather`);
    } catch (error) {
        console.error('Error loading cached weather data:', error);
    }
}

async function updateCourseWeatherInDatabase(courseId, weatherData) {
    try {
        const { error } = await supabase
            .from('courses')
            .update({
                last_weather_update: new Date().toISOString(),
                temperature: weatherData.temperature,
                description: weatherData.description,
                humidity: weatherData.humidity,
                wind_speed: weatherData.windSpeed,
                wind_direction: weatherData.windDirection,
                visibility: weatherData.visibility,
                is_raining: weatherData.isRaining
            })
            .eq('id', courseId);
        
        if (error) {
            console.error(`Error updating weather for course ${courseId}:`, error);
        } else {
            console.log(`Weather data saved to database for course ${courseId}`);
        }
    } catch (error) {
        console.error('Error saving weather to database:', error);
    }
}

function isRainyWeather(description, main, precipitation = 0) {
    // Check precipitation amount first (Open-Meteo provides this)
    if (precipitation && precipitation > 0) {
        return true;
    }
    
    const rainKeywords = [
        'rain', 'drizzle', 'shower', 'precipitation',
        'light rain', 'moderate rain', 'heavy rain',
        'patchy rain', 'light drizzle', 'heavy drizzle',
        'thunderstorm', 'storm', 'rainy', 'wet',
        'downpour', 'sprinkle', 'mizzle'
    ];
    
    const weatherText = `${description} ${main}`.toLowerCase();
    
    return rainKeywords.some(keyword => weatherText.includes(keyword));
}

// Add this debug function
function debugRainCanvas() {
    const rainCards = document.querySelectorAll('.course-card.has-rain');
    console.log(`Found ${rainCards.length} rain cards`);
    
    rainCards.forEach((card, index) => {
        const canvas = card.querySelector('canvas');
        if (canvas) {
            console.log(`Card ${index} canvas:`, {
                width: canvas.width,
                height: canvas.height,
                style: canvas.style.cssText,
                visible: canvas.offsetWidth > 0 && canvas.offsetHeight > 0
            });
            
            // Draw a test rectangle to verify canvas is working
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = 'red';
            ctx.fillRect(10, 10, 50, 20);
            console.log('Drew test rectangle on canvas');
        } else {
            console.log(`Card ${index} has no canvas`);
        }
    });
}

// Add this debug function to help track rain detection
function debugWeatherData(course, weatherData) {
    if (weatherData) {
        console.log(`Weather debug for ${course.name}:`, {
            description: weatherData.description,
            main: weatherData.main,
            precipitation: weatherData.precipitation || 0,
            isRaining: weatherData.isRaining,
            temperature: weatherData.temperature
        });
    }
}

// Replace the existing addRainAnimationStyles function
function addRainAnimationStyles() {
    if (document.getElementById('rain-animation-styles')) return;
    
    const styles = document.createElement('style');
    styles.id = 'rain-animation-styles';
    styles.textContent = `
        .course-card {
            position: relative !important;
            overflow: hidden !important;
        }
        
        .course-card.has-rain {
            background: linear-gradient(135deg, 
                rgba(156, 163, 175, 0.15) 0%, 
                rgba(209, 213, 219, 0.1) 100%) !important;
            border-color: rgba(156, 163, 175, 0.3) !important;
        }
        
        /* Selected course should override rain styling */
        .course-card.selected-course {
            background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%) !important;
            border-color: #3b82f6 !important;
            box-shadow: 0 2px 8px rgba(59, 130, 246, 0.25) !important;
        }
        
        /* Rain overlay for selected course should be more subtle */
        .course-card.selected-course.has-rain {
            background: linear-gradient(135deg, 
                rgba(239, 246, 255, 0.9) 0%, 
                rgba(219, 234, 254, 0.8) 100%) !important;
        }
        
        .course-card canvas {
            border-radius: inherit !important;
        }
    `;
    document.head.appendChild(styles);
}

function stopRainAnimation(container) {
    container.classList.remove('has-rain');
    
    // Cancel animation frame
    if (container._rainAnimationId) {
        cancelAnimationFrame(container._rainAnimationId);
        delete container._rainAnimationId;
    }
    
    // Stop resize observer
    if (container._rainResizeObserver) {
        container._rainResizeObserver.disconnect();
        delete container._rainResizeObserver;
    }
    
    // Remove rain elements
    const canvas = container._rainCanvas;
    if (canvas && canvas.parentNode === container) {
        container.removeChild(canvas);
    }
    
    const overlay = container.querySelector('[style*="linear-gradient"][style*="107, 114, 128"]');
    if (overlay && overlay.parentNode === container) {
        container.removeChild(overlay);
    }
    
    delete container._rainCanvas;
}

function getRainIntensity(description, precipitation = 0) {
    // First check precipitation amount if available
    if (precipitation > 0) {
        if (precipitation < 0.5) return 0.2;  // Very light drizzle
        if (precipitation < 2) return 0.4;    // Light rain
        if (precipitation < 7.5) return 0.6;  // Moderate rain
        if (precipitation < 50) return 0.8;   // Heavy rain
        return 1.0; // Very heavy rain
    }
    
    // Fallback to description parsing
    const desc = description.toLowerCase();
    
    // Check for intensity modifiers
    if (desc.includes('heavy') || desc.includes('intense') || desc.includes('torrential')) {
        return 0.9;
    }
    if (desc.includes('moderate') || desc.includes('steady')) {
        return 0.6;
    }
    if (desc.includes('light') || desc.includes('slight') || desc.includes('drizzle')) {
        return 0.3;
    }
    if (desc.includes('shower')) {
        return 0.7; // Showers are typically heavier but intermittent
    }
    if (desc.includes('mist') || desc.includes('fog')) {
        return 0.15;
    }
    
    // Default for generic "rain"
    if (desc.includes('rain')) {
        return 0.5;
    }
    
    return 0.4; // Default medium-light intensity
}

function createRainAnimation(container, weather = null) {
    console.log('Creating rain animation for container:', container, 'with weather:', weather);
    
    // Ensure container is in DOM before proceeding
    if (!document.contains(container)) {
        console.log('Container not in DOM, delaying rain animation');
        setTimeout(() => createRainAnimation(container, weather), 100);
        return;
    }
    
    // Add rain class to container
    container.classList.add('has-rain');
    
    // Ensure container has proper positioning
    if (getComputedStyle(container).position === 'static') {
        container.style.position = 'relative';
    }

    // Extract weather parameters
    const windSpeed = weather?.windSpeed || 0; // m/s
    const windDirection = weather?.windDirection || 270; // degrees
    const rainIntensity = getRainIntensity(weather?.description || '', weather?.precipitation || 0);
    
    // Scale wind effect for small container
    const windAngleRad = ((windDirection + 180) % 360) * Math.PI / 180;
    const windVelocityX = Math.sin(windAngleRad) * windSpeed * 0.8; // Reduced for small area
    const windVelocityY = Math.max(0, -Math.cos(windAngleRad) * windSpeed * 0.2);

    console.log(`Weather: intensity=${rainIntensity}, wind=${windSpeed}m/s @${windDirection}°`);
    
    // Adjust drop count for small area - more drops but smaller
    const baseDropCount = 60; // Reduced base count for small area
    const dropCount = Math.round(baseDropCount + (baseDropCount * rainIntensity * 5));
    
    // Create rain system
    const rainDrops = [];
    
    // Create canvas for rain animation
    const canvas = document.createElement('canvas');
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '5';
    canvas.style.borderRadius = 'inherit';
    
    const ctx = canvas.getContext('2d');
    
    // Set canvas size and initialize drops
    const initializeRain = () => {
        const rect = container.getBoundingClientRect();
        canvas.width = rect.width || 290;
        canvas.height = rect.height || 92;
        
        console.log(`Canvas size: ${canvas.width}x${canvas.height}`);
        
        // Clear and recreate drops
        rainDrops.length = 0;

        // Create rain drops optimized for small area
        for (let i = 0; i < dropCount; i++) {
            // Smaller drops for small container
            const sizeMultiplier = 0.6 + Math.random() * 0.4;
            
            // Slower base velocity for small area
            const baseVelocity = 2 + rainIntensity * 1.5; // Reduced speed
            
            // Individual drop variation
            const dropWindEffect = 0.7 + Math.random() * 0.6;
            const vx = windVelocityX * dropWindEffect + (Math.random() - 0.5) * 0.3;
            const vy = baseVelocity + Math.random() * 2 + windVelocityY;
            
            rainDrops.push({
                x: Math.random() * (canvas.width*2), // Smaller margin
                y: Math.random() * canvas.height - canvas.height - 20,
                vx: vx,
                vy: vy,
                width: 1 + Math.random() * 0.5 * sizeMultiplier, // Thinner drops
                length: (4 + Math.random() * 4) * sizeMultiplier * (1 + rainIntensity * 0.2), // Shorter drops
                opacity: 0.3 + Math.random() * 0.4 + rainIntensity * 0.15, // More visible
                angle: Math.atan2(vx, vy),
                // Add speed variation for more natural look
                speedMultiplier: 0.8 + Math.random() * 0.4
            });
        }
        
        console.log(`Initialized ${rainDrops.length} rain drops for small container`);
    };
    
    initializeRain();
    
    let animationId;
    let isAnimating = true;
    let lastTime = performance.now();
    
    // Animation function optimized for small area
    function updateRain(currentTime) {
        // Check if animation should continue
        if (!isAnimating || !container.classList.contains('has-rain')) {
            if (animationId) {
                cancelAnimationFrame(animationId);
            }
            return;
        }
        
        // Check container is still in DOM
        if (!document.contains(container)) {
            isAnimating = false;
            if (animationId) {
                cancelAnimationFrame(animationId);
            }
            return;
        }
        
        // Calculate delta time for smooth animation
        const deltaTime = Math.min((currentTime - lastTime) / 16.67, 2);
        lastTime = currentTime;
        
        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Set composite operation for better visibility
        ctx.globalCompositeOperation = 'source-over';
        
        // Update and draw each rain drop
        for (let i = 0; i < rainDrops.length; i++) {
            const drop = rainDrops[i];
            
            // Update position with individual speed
            drop.x += drop.vx * deltaTime * drop.speedMultiplier;
            drop.y += drop.vy * deltaTime * drop.speedMultiplier;
            
            // Draw rain drop as a thin line
            ctx.save();
            ctx.globalAlpha = drop.opacity;
            
            // Simpler rendering for small size - solid color instead of gradient
            ctx.strokeStyle = `rgba(156, 163, 175, ${drop.opacity * 0.9})`;
            ctx.lineWidth = drop.width;
            ctx.lineCap = 'round';
            
            ctx.beginPath();
            ctx.moveTo(drop.x, drop.y);
            ctx.lineTo(
                drop.x - Math.sin(drop.angle) * drop.length,
                drop.y - Math.cos(drop.angle) * drop.length
            );
            ctx.stroke();
            
            ctx.restore();
            
            // Reset drop when it goes off screen - tighter bounds for small area
            if (drop.y > canvas.height + 10) {
                drop.x = Math.random() * (canvas.width*2);
                drop.y = -10 - Math.random() * 30;
                // Maintain some variety in reset
                const dropWindEffect = 0.7 + Math.random() * 0.6;
                drop.vx = windVelocityX * dropWindEffect + (Math.random() - 0.5) * 0.3;
                drop.vy = (2 + rainIntensity * 1.5) + Math.random() * 2 + windVelocityY;
                drop.angle = Math.atan2(drop.vx, drop.vy);
                drop.speedMultiplier = 0.8 + Math.random() * 0.4;
                drop.opacity = 0.3 + Math.random() * 0.4 + rainIntensity * 0.15;
            }
            
            // Reset if blown off sides (tighter margin for small area)
            if (drop.x < -canvas.width / 2 || drop.x > canvas.width*1.5) {
                drop.x = Math.random() * (canvas.width*2);
                drop.y = -10 - Math.random() * 30;
                const dropWindEffect = 0.7 + Math.random() * 0.6;
                drop.vx = windVelocityX * dropWindEffect + (Math.random() - 0.5) * 0.3;
                drop.vy = (2 + rainIntensity * 1.5) + Math.random() * 2 + windVelocityY;
                drop.angle = Math.atan2(drop.vx, drop.vy);
                drop.speedMultiplier = 0.8 + Math.random() * 0.4;
            }
        }
        
        animationId = requestAnimationFrame(updateRain);
    }
    
    // Add subtle overlay for small area
    const overlay = document.createElement('div');
    overlay.style.position = 'absolute';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    const overlayOpacity = 0.03 + rainIntensity * 0.02; // Very subtle for small area
    overlay.style.background = `linear-gradient(135deg, 
        rgba(107, 114, 128, ${overlayOpacity}) 0%, 
        rgba(156, 163, 175, ${overlayOpacity * 0.5}) 50%, 
        rgba(107, 114, 128, ${overlayOpacity}) 100%)`;
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '4';
    overlay.style.borderRadius = 'inherit';
    
    // Insert elements into container
    container.insertBefore(overlay, container.firstChild);
    container.insertBefore(canvas, container.firstChild);
    
    // Start animation
    console.log('Starting rain animation optimized for small container');
    updateRain(performance.now());
    
    // Store references for cleanup
    container._rainCanvas = canvas;
    container._rainAnimationId = animationId;
    container._rainIsAnimating = () => isAnimating;
    container._rainStopAnimation = () => { isAnimating = false; };
    
    // Handle resize events
    const resizeObserver = new ResizeObserver(() => {
        if (isAnimating && document.contains(container)) {
            initializeRain();
        }
    });
    resizeObserver.observe(container);
    container._rainResizeObserver = resizeObserver;
}

function preserveRainState() {
    const rainStates = [];
    
    console.log('=== Preserving Rain State Debug ===');
    console.log(`Total courses with weather data: ${coursesData.filter(c => c.weather).length}`);
    console.log(`Courses with rain: ${coursesData.filter(c => c.weather && c.weather.isRaining).length}`);
    
    // Get rain states from course cards with rain
    const rainCards = document.querySelectorAll('.course-card.has-rain');
    console.log(`DOM elements with has-rain class: ${rainCards.length}`);
    
    rainCards.forEach(card => {
        const courseId = card.dataset.courseId;
        if (courseId) {
            const course = coursesData.find(c => c.id == courseId);
            if (course) {
                rainStates.push({
                    courseId: courseId,
                    courseName: course.name,
                    hasRain: true,
                    weather: course.weather
                });
                console.log(`Preserved rain state for: ${course.name}`);
            }
        }
    });
    
    // Also check courses that should have rain but don't have DOM elements yet
    coursesData.forEach(course => {
        if (course.weather && course.weather.isRaining) {
            const existingState = rainStates.find(state => state.courseId == course.id);
            if (!existingState) {
                console.log(`Course ${course.name} should have rain but no DOM element found`);
                rainStates.push({
                    courseId: course.id,
                    courseName: course.name,
                    hasRain: true,
                    weather: course.weather
                });
            }
        }
    });
    
    console.log('Final preserved rain states:', rainStates);
    return rainStates;
}

function restoreRainStateToNewElements(rainStates) {
    if (!rainStates || rainStates.length === 0) {
        console.log('No rain states to restore');
        return;
    }
    
    console.log('Restoring rain states to new elements:', rainStates);
    
    // Use a timeout to ensure DOM elements are fully rendered
    setTimeout(() => {
        rainStates.forEach(state => {
            if (state.hasRain) {
                const courseCard = document.querySelector(`[data-course-id="${state.courseId}"]`);
                if (courseCard && !courseCard.classList.contains('has-rain')) {
                    console.log(`Restoring rain to course: ${state.courseName}`);
                    createRainAnimation(courseCard, state.weather);
                } else if (!courseCard) {
                    console.log(`Could not find course card for: ${state.courseName}`);
                }
            }
        });
    }, 100); // Small delay to ensure DOM is ready
}

function handleShowMoreLess() {
    // Store rain states temporarily
    window._tempRainStates = preserveRainState();
}

// Add this test function
function testRainAnimation() {
    console.log('Testing rain animation...');
    
    // Create a test element to verify CSS is working
    const testDrop = document.createElement('div');
    testDrop.className = 'rain-drop';
    testDrop.style.position = 'fixed';
    testDrop.style.top = '10px';
    testDrop.style.left = '50px';
    testDrop.style.zIndex = '10000';
    document.body.appendChild(testDrop);
    
    // Remove after 5 seconds
    setTimeout(() => {
        if (document.body.contains(testDrop)) {
            document.body.removeChild(testDrop);
        }
    }, 5000);
    
    console.log('Test rain drop created - you should see it falling from the top left');
}

// Add helper function for weather codes
function getWeatherDescription(weathercode) {
    const codes = {
        0: 'Clear sky',
        1: 'Mainly clear',
        2: 'Partly cloudy',
        3: 'Overcast',
        45: 'Fog',
        48: 'Depositing rime fog',
        51: 'Light drizzle',
        53: 'Moderate drizzle',
        55: 'Dense drizzle',
        61: 'Slight rain',
        63: 'Moderate rain',
        65: 'Heavy rain',
        71: 'Slight snow',
        73: 'Moderate snow',
        75: 'Heavy snow',
        80: 'Slight rain showers',
        81: 'Moderate rain showers',
        82: 'Violent rain showers',
        95: 'Thunderstorm',
        96: 'Thunderstorm with hail',
        99: 'Thunderstorm with heavy hail'
    };
    
    return codes[weathercode] || 'Unknown';
}

async function loadWeatherFromDatabase() {
    try {
        const { data: coursesWithWeather, error } = await supabase
            .from("courses")
            .select("id, last_weather_update, temperature, description, humidity, wind_speed, wind_direction, visibility, is_raining");
        
        if (error) {
            console.error("Error loading weather from database:", error);
            return;
        }

        coursesWithWeather.forEach(courseWeather => {
            const course = coursesData.find(c => c.id === courseWeather.id);
            if (course && courseWeather.last_weather_update) {
                // Check if weather data is recent (less than 30 minutes old)
                const weatherAge = Date.now() - new Date(courseWeather.last_weather_update).getTime();
                console.log("This course is old:", weatherAge);
                if (weatherAge < 5 * 60 * 1000) { // 30 minutes
                    course.weather = {
                        temperature: courseWeather.temperature,
                        description: courseWeather.description,
                        main: courseWeather.description, // Use description as main for consistency
                        humidity: courseWeather.humidity,
                        windSpeed: courseWeather.wind_speed,
                        windDirection: courseWeather.wind_direction,
                        visibility: courseWeather.visibility,
                        isRaining: courseWeather.is_raining
                    };
                }
            }
        });
        
        console.log(`Loaded weather from database for ${coursesWithWeather.filter(c => c.last_weather_update).length} courses`);
    } catch (error) {
        console.error('Error loading weather from database:', error);
    }
}


// Weather system exports
window.loadWeather = loadWeather;
window.loadWeatherForAllCourses = loadWeatherForAllCourses;
window.loadWeatherFromDatabase = loadWeatherFromDatabase;
window.getWeatherForCourse = getWeatherForCourse;
window.getWeatherWithFallback = getWeatherWithFallback;
window.fetchWeatherFromAPI = fetchWeatherFromAPI;
window.loadCachedWeatherData = loadCachedWeatherData;
window.updateCourseWeatherInDatabase = updateCourseWeatherInDatabase;
window.applyRainAnimationsToAllCourses = applyRainAnimationsToAllCourses;

// Weather utility functions
window.getWeatherEmoji = getWeatherEmoji;
window.getWeatherMain = getWeatherMain;
window.getWeatherDescription = getWeatherDescription;
window.isRainyWeather = isRainyWeather;
window.isWithinRadius = isWithinRadius;
window.extractWindDataFromAPI = extractWindDataFromAPI;
window.startWeatherAutoRefresh = startWeatherAutoRefresh;
window.stopWeatherAutoRefresh = stopWeatherAutoRefresh;

// Rain animation functions
window.createRainAnimation = createRainAnimation;
window.stopRainAnimation = stopRainAnimation;
window.addRainAnimationStyles = addRainAnimationStyles;
window.preserveRainState = preserveRainState;
window.restoreRainStateToNewElements = restoreRainStateToNewElements;
window.handleShowMoreLess = handleShowMoreLess;

// Debug functions
window.toggleDebugRain = toggleDebugRain;
window.debugRainSystem = debugRainSystem;
window.debugRainCanvas = debugRainCanvas;
window.debugWeatherData = debugWeatherData;
window.forceRainOnFirstCourse = forceRainOnFirstCourse;
window.testRainAnimation = testRainAnimation;

// Cleanup function
window.cleanupOldWeatherData = cleanupOldWeatherData;