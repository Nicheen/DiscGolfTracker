const weatherCache = new Map();

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
    const cutoffDate = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours instead of 24
    
    try {
        const results = await Promise.allSettled([
            supabase
                .from('weather_cache')
                .delete()
                .lt('updated_at', cutoffDate.toISOString()),
            supabase
                .from('course_weather')
                .delete()
                .lt('updated_at', cutoffDate.toISOString())
        ]);
        
        results.forEach((result, index) => {
            const tableName = index === 0 ? 'weather_cache' : 'course_weather';
            if (result.status === 'fulfilled') {
                console.log(`Cleaned up old ${tableName} data`);
            } else {
                console.error(`Error cleaning up ${tableName}:`, result.reason);
            }
        });
        
    } catch (error) {
        console.error('Error cleaning up weather data:', error);
    }
}

// Enhanced weather loading for all courses
async function loadWeatherForAllCourses() {
    addRainAnimationStyles();
    
    try {
        // Clean up old data first
        await cleanupOldWeatherData();
        
        // Process courses in batches to avoid rate limiting
        const batchSize = 5;
        for (let i = 0; i < coursesData.length; i += batchSize) {
            const batch = coursesData.slice(i, i + batchSize);
            
            await Promise.all(batch.map(async (course, batchIndex) => {
                const globalIndex = i + batchIndex;
                if (course.coordinates) {
                    const weather = await getWeatherForCourse(course);
                    coursesData[globalIndex].weather = weather;
                }
            }));
            
            // Small delay between batches
            if (i + batchSize < coursesData.length) {
                await new Promise(resolve => setTimeout(resolve, 200));
            }
        }
        
        displayCourses();
        
    } catch (error) {
        console.error('Error loading weather for courses:', error);
        displayCourses(); // Fallback to display without weather
    }
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
    const weatherWidget = document.getElementById('weather-widget');
    const weatherIcon = document.getElementById('weather-icon');
    const weatherTemp = document.getElementById('weather-temp');
    const weatherDesc = document.getElementById('weather-desc');
    
    if (!weatherWidget) return;
    
    try {
        // Show loading state
        if (weatherIcon) {
            weatherIcon.textContent = '🔄';
            weatherIcon.style.animation = 'spin 1s linear infinite';
        }
        
        // Get user location (with cache support)
        const location = await getUserLocationWithCache();
        if (!location) {
            weatherWidget.classList.add('hidden');
            return;
        }

        // Get current user for dynamic course ID
        const { data: { user } } = await supabase.auth.getUser();
        
        // In loadWeather(), change this line:
        const userLocationCourse = {
            id: 'user_location', // Use fixed string instead of dynamic user ID
            name: 'Current Location',
            coordinates: `${location.latitude},${location.longitude}`
        };
        
        // Use the same weather system as courses (with caching and API fallback)
        const weather = await getWeatherForCourse(userLocationCourse);
        if (!weather) {
            weatherWidget.classList.add('hidden');
            return;
        }
        
        // Stop loading animation
        if (weatherIcon) {
            weatherIcon.style.animation = '';
        }
        
        // Update UI with enhanced styling
        const emoji = getWeatherEmoji(weather.main, weather.temperature);
        
        weatherIcon.textContent = emoji;
        weatherTemp.textContent = `${weather.temperature}°`;
        weatherDesc.textContent = weather.description.charAt(0).toUpperCase() + weather.description.slice(1);
        
        // Update widget styling based on weather
        if (weather.isRaining) {
            weatherWidget.className = 'flex items-center gap-2 bg-blue-100/80 backdrop-blur-sm px-3 py-2 rounded-lg border border-blue-200/50 shadow-sm cursor-pointer transition-all duration-200 hover:bg-blue-200/80';
            weatherTemp.className = 'font-semibold text-blue-800';
            weatherDesc.className = 'text-xs text-blue-700';
        } else {
            weatherWidget.className = 'flex items-center gap-2 bg-white/80 backdrop-blur-sm px-3 py-2 rounded-lg border border-gray-200/50 shadow-sm cursor-pointer transition-all duration-200 hover:bg-gray-100/80';
            weatherTemp.className = 'font-semibold text-gray-800';
            weatherDesc.className = 'text-xs text-gray-700';
        }
        
        // Enhanced tooltip with weather details
        const now = new Date();
        const timeString = now.toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit',
            hour12: false 
        });
        const accuracy = location.accuracy ? ` (±${Math.round(location.accuracy)}m)` : '';
        const cacheStatus = location.fromCache ? ' • Cached' : ' • Fresh';
        
        let tooltipDetails = `${weather.description.charAt(0).toUpperCase() + weather.description.slice(1)}`;
        if (weather.humidity) tooltipDetails += `\nHumidity: ${weather.humidity}%`;
        if (weather.windSpeed) tooltipDetails += `\nWind: ${Math.round(weather.windSpeed * 3.6)} km/h`;
        tooltipDetails += `\nLast updated: ${timeString}${accuracy}${cacheStatus}\nClick to refresh`;
        
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
        weatherIcon.textContent = location.fromCache ? '💾' : '✨';
        setTimeout(() => {
            weatherIcon.textContent = originalIcon;
        }, 1200);
        
        console.log(`Weather loaded for user location: ${weather.temperature}°C, ${weather.description} (${location.fromCache ? 'cached' : 'fresh'})`);
        
    } catch (error) {
        console.error('Error loading weather:', error);
        
        // Show error state briefly before hiding
        if (weatherIcon) {
            weatherIcon.style.animation = '';
            weatherIcon.textContent = '⚠️';
            weatherTemp.textContent = 'Error';
            weatherDesc.textContent = 'Weather unavailable';
            
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
        // First check course-specific cache
        const { data: courseWeather, error: courseError } = await supabase
            .from('course_weather')
            .select('*')
            .eq('course_id', course.id)
            .gte('updated_at', new Date(Date.now() - WEATHER_CONFIG.CACHE_DURATION).toISOString())
            .order('updated_at', { ascending: false })
            .limit(1);
        
        if (!courseError && courseWeather && courseWeather.length > 0) {
            console.log(`Using cached course weather for ${course.name}`);
            return courseWeather[0].weather_data;
        }
        
        // Check for nearby weather data BEFORE making API calls
        const { data: nearbyWeather, error: nearbyError } = await supabase
            .from('weather_cache')
            .select('*')
            .gte('updated_at', new Date(Date.now() - WEATHER_CONFIG.CACHE_DURATION).toISOString())
            .order('updated_at', { ascending: false });
        
        if (!nearbyError && nearbyWeather) {
            const nearby = nearbyWeather.find(w => 
                isWithinRadius(lat, lon, w.latitude, w.longitude)
            );
            
            if (nearby) {
                console.log(`Using nearby cached weather for ${course.name}`);
                const weatherData = {
                    temperature: nearby.temperature,
                    description: nearby.description,
                    main: nearby.weather_main,
                    humidity: nearby.humidity,
                    pressure: nearby.pressure,
                    windSpeed: nearby.wind_speed,
                    visibility: nearby.visibility,
                    isRaining: nearby.is_raining
                };
                
                // Cache for this specific course but DON'T create new weather_cache entry
                await supabase
                    .from('course_weather')
                    .upsert({
                        course_id: course.id,
                        weather_data: weatherData,
                        updated_at: new Date()
                    });
                
                return weatherData;
            }
        }
        
        // Only fetch fresh weather if no nearby cache found
        console.log(`Fetching fresh weather for ${course.name}`);
        const apiWeatherData = await getWeatherWithFallback(lat, lon);
        
        const processedData = {
            temperature: apiWeatherData.temperature,
            description: apiWeatherData.description.toLowerCase(),
            main: apiWeatherData.main,
            humidity: apiWeatherData.humidity,
            pressure: apiWeatherData.pressure,
            windSpeed: apiWeatherData.windSpeed,
            visibility: apiWeatherData.visibility,
            isRaining: isRainyWeather(
                apiWeatherData.description.toLowerCase(), 
                apiWeatherData.main.toLowerCase(),
                apiWeatherData.precipitation || 0
            )
        };

        // Check AGAIN if someone else just created a nearby cache entry
        const { data: recentNearby } = await supabase
            .from('weather_cache')
            .select('*')
            .gte('updated_at', new Date(Date.now() - 60000).toISOString()) // Last 1 minute
            .order('updated_at', { ascending: false });
        
        const existingNearby = recentNearby?.find(w => 
            isWithinRadius(lat, lon, w.latitude, w.longitude, 100) // Tighter radius for duplicates
        );
        
        if (!existingNearby) {
            // Only create new cache entry if none exists nearby
            await supabase.from('weather_cache').insert({
                latitude: lat,
                longitude: lon,
                temperature: processedData.temperature,
                description: processedData.description,
                weather_main: processedData.main,
                humidity: processedData.humidity,
                pressure: processedData.pressure,
                wind_speed: processedData.windSpeed,
                visibility: processedData.visibility,
                is_raining: processedData.isRaining
            });
        }
        
        // Always cache for this specific course
        await supabase.from('course_weather').upsert({
            course_id: course.id,
            weather_data: processedData,
            updated_at: new Date()
        });
        
        return processedData;
        
    } catch (error) {
        console.error('Error getting weather for course:', error);
        return null;
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

    // Extract wind parameters from weather data
    const windSpeed = weather?.windSpeed || 0; // m/s
    const windDirection = weather?.windDirection || 270; // degrees (270 = west wind)
    
    // Convert wind speed to pixel velocity (scale factor for visual effect)
    const windVelocityX = Math.sin(windDirection * Math.PI / 180) * windSpeed * 2;
    const windVelocityY = Math.cos(windDirection * Math.PI / 180) * windSpeed * 0.5;

    console.log(`Wind parameters: speed=${windSpeed}m/s, direction=${windDirection}°, vx=${windVelocityX.toFixed(2)}, vy=${windVelocityY.toFixed(2)}`);
    
    // Create rain system with continuous looping
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
        canvas.width = rect.width || 200;
        canvas.height = rect.height || 150;
        
        console.log(`Canvas size: ${canvas.width}x${canvas.height}`);
        
        // Clear existing drops
        rainDrops.length = 0;

        // Create initial rain drops spread across time
        for (let i = 0; i < 30; i++) {
            rainDrops.push({
                x: Math.random() * canvas.width,
                y: Math.random() * canvas.height - canvas.height,
                vx: (Math.random() - 0.5) * 1 + windVelocityX, // Add wind horizontal velocity
                vy: 3 + Math.random() * 4 + Math.abs(windVelocityY), // Add wind vertical component
                width: 1 + Math.random() * 1,
                height: 8 + Math.random() * 12,
                opacity: 0.4 + Math.random() * 0.4
            });
        }
        
        console.log(`Initialized ${rainDrops.length} rain drops with wind effect`);
    };
    
    initializeRain();
    
    let animationId;
    let isAnimating = true;
    
    // Animation function - continuous loop
    function updateRain() {
        // Check if animation should continue
        if (!isAnimating || !container.classList.contains('has-rain')) {
            console.log('Rain animation stopped - animation flag or rain class removed');
            if (animationId) {
                cancelAnimationFrame(animationId);
            }
            return;
        }
        
        // Double-check container is still in DOM
        if (!document.contains(container)) {
            console.log('Rain animation stopped - container removed from DOM');
            isAnimating = false;
            if (animationId) {
                cancelAnimationFrame(animationId);
            }
            return;
        }
        
        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Update and draw each rain drop
        for (let i = 0; i < rainDrops.length; i++) {
            const drop = rainDrops[i];
            
            // Update position
            drop.x += drop.vx;
            drop.y += drop.vy;
            
            // Draw rain drop with gray color instead of blue
            ctx.save();
            ctx.globalAlpha = drop.opacity;
            ctx.fillStyle = `rgba(107, 114, 128, ${drop.opacity * 0.6})`; // Gray rain drops
            ctx.fillRect(drop.x, drop.y, drop.width, drop.height);
            ctx.restore();
            
            // Reset drop when it goes off screen
            if (drop.y > canvas.height + 20) {
                drop.x = Math.random() * canvas.width;
                drop.y = -20;
                drop.vx = (Math.random() - 0.5) * 1 + windVelocityX; // Refresh wind velocity
                drop.vy = 3 + Math.random() * 4 + Math.abs(windVelocityY);
            }
            
            // Reset horizontal position with wider margin for wind drift
            if (drop.x < -50 || drop.x > canvas.width + 50) {
                drop.x = Math.random() * canvas.width;
                drop.y = -50 - Math.random() * 100;
                drop.vx = (Math.random() - 0.5) * 1 + windVelocityX;
                drop.vy = 3 + Math.random() * 4 + Math.abs(windVelocityY);
            }
        }
        
        animationId = requestAnimationFrame(updateRain);
    }
    
    // Add rain overlay
    const overlay = document.createElement('div');
    overlay.style.position = 'absolute';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.background = 'linear-gradient(135deg, rgba(107, 114, 128, 0.04) 0%, rgba(156, 163, 175, 0.02) 50%, rgba(107, 114, 128, 0.04) 100%)';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '4';
    overlay.style.borderRadius = 'inherit';
    
    // Insert elements into container
    container.insertBefore(overlay, container.firstChild);
    container.insertBefore(canvas, container.firstChild);
    
    // Start animation
    console.log('Starting rain animation');
    updateRain();
    
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

// Enhanced rain state preservation that checks course weather data
function preserveRainState() {
    const rainStates = [];
    
    // Get rain states from course cards with rain
    const rainCards = document.querySelectorAll('.course-card.has-rain');
    rainCards.forEach(card => {
        const courseId = card.dataset.courseId;
        if (courseId) {
            const course = coursesData.find(c => c.id == courseId);
            if (course) {
                rainStates.push({
                    courseId: courseId,
                    courseName: course.name,
                    hasRain: true,
                    weather: course.weather // Include weather data
                });
            }
        }
    });
    
    console.log('Preserving rain states:', rainStates);
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


window.testRainAnimation = testRainAnimation;
window.debugRainCanvas = debugRainCanvas;
window.stopRainAnimation = stopRainAnimation;