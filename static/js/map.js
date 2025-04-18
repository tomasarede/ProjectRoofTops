// Global variables
let map;
let drawnItems;
let drawControl;
let selectedArea = null;
let rooftopLayers = [];
let sizeDistributionChart = null;

/**
 * Initialize the Leaflet map
 * @param {Object} bounds - The bounds of Portugal
 */
function initMap(bounds) {
    // Create the map centered on Portugal
    map = L.map('map').fitBounds([
        [bounds.south, bounds.west],
        [bounds.north, bounds.east]
    ]);

    // Add the OpenStreetMap tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
    }).addTo(map);

    // Add a satellite layer as an option
    const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Imagery &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
        maxZoom: 19
    });

    // Add layer control
    const baseLayers = {
        "OpenStreetMap": L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'),
        "Satellite": satelliteLayer
    };
    
    L.control.layers(baseLayers).addTo(map);
    
    // Add geocoding search control
    const searchControl = L.Control.geocoder({
        defaultMarkGeocode: false,
        placeholder: 'Search address or location...',
        errorMessage: 'Nothing found.',
        geocoder: L.Control.Geocoder.nominatim({
            geocodingQueryParams: {
                countrycodes: 'pt', // Limit to Portugal
                limit: 5
            }
        })
    }).addTo(map);
    
    // Handle search results
    searchControl.on('markgeocode', function(e) {
        const bbox = e.geocode.bbox;
        const poly = L.polygon([
            bbox.getSouthEast(),
            bbox.getNorthEast(),
            bbox.getNorthWest(),
            bbox.getSouthWest()
        ], {
            color: '#38b5ff',
            weight: 2,
            opacity: 0.8,
            fillColor: '#38b5ff',
            fillOpacity: 0.2
        });
        
        // Clear existing highlight
        if (window.searchHighlight) {
            map.removeLayer(window.searchHighlight);
            if (window.searchHighlightTimer) {
                clearTimeout(window.searchHighlightTimer);
            }
        }
        
        // Add new highlight
        window.searchHighlight = poly;
        poly.addTo(map);
        
        // Zoom to the result
        map.fitBounds(poly.getBounds());
        
        // Show a popup with the name
        const popup = L.popup()
            .setLatLng(e.geocode.center)
            .setContent(`<strong>${e.geocode.name}</strong>`)
            .openOn(map);
            
        // Automatically remove the highlight after 5 seconds
        window.searchHighlightTimer = setTimeout(function() {
            if (window.searchHighlight) {
                map.removeLayer(window.searchHighlight);
                window.searchHighlight = null;
            }
            map.closePopup(popup);
        }, 5000);
    });

    // Initialize the FeatureGroup to store editable layers
    drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);

    // Initialize the draw control with rectangle and polygon options
    drawControl = new L.Control.Draw({
        edit: false, // Disable edit toolbar
        draw: {
            polygon: {
                allowIntersection: false,
                shapeOptions: {
                    color: '#4e73df',
                    weight: 3
                },
                showArea: true,
                metric: true,
                drawError: {
                    color: '#e1e100',
                    message: '<strong>Error:</strong> Polygon edges cannot cross!'
                },
                guidelineDistance: 10
            },
            polyline: false,
            rectangle: {
                shapeOptions: {
                    color: '#4e73df',
                    weight: 3
                },
                showArea: true,
                metric: true
            },
            circle: false,
            marker: false,
            circlemarker: false
        }
    });
    map.addLayer(drawnItems);
    map.addControl(drawControl);

    // Event handler for when a shape is created
    map.on(L.Draw.Event.CREATED, function (event) {
        const layer = event.layer;
        drawnItems.addLayer(layer);
        selectedArea = layer;
        updateAreaInfo(layer);
        document.getElementById('analyzeBtn').disabled = false;
    });

    // Event handler for when a shape is edited
    map.on(L.Draw.Event.EDITED, function (event) {
        const layers = event.layers;
        layers.eachLayer(function (layer) {
            selectedArea = layer;
            updateAreaInfo(layer);
        });
    });

    // Event handler for when a shape is deleted
    map.on(L.Draw.Event.DELETED, function (event) {
        selectedArea = null;
        document.getElementById('analyzeBtn').disabled = true;
    });

    // Add event listeners for the analyze button
    document.getElementById('analyzeBtn').addEventListener('click', analyzeSelectedArea);
    
    // Add event listener for the clear button
    document.getElementById('clearBtn').addEventListener('click', clearMap);
    
    // Event listeners for export buttons have been removed as they are no longer needed
}

/**
 * Update area information based on the selected layer
 * @param {L.Layer} layer - The selected layer
 */
function updateAreaInfo(layer) {
    const bounds = layer.getBounds();
    const areaSqKm = calculateAreaInSqKm(layer);
    
    // Check if the area exceeds the maximum allowed
    const maxArea = parseFloat(document.getElementById('maxAreaInput').value);
    
    if (areaSqKm > maxArea) {
        showAlert(`Selected area (${areaSqKm.toFixed(2)} km²) exceeds the maximum allowed (${maxArea} km²).`);
        document.getElementById('analyzeBtn').disabled = true;
    } else {
        hideAlert();
        document.getElementById('analyzeBtn').disabled = false;
    }
}

/**
 * Calculate the area of a layer in square kilometers
 * @param {L.Layer} layer - The layer to calculate the area for
 * @returns {number} Area in square kilometers
 */
function calculateAreaInSqKm(layer) {
    // Get the bounds of the layer
    const bounds = layer.getBounds();
    
    // Calculate the approximate area in square kilometers
    const width = calcHaversineDistance(
        bounds.getSouthWest().lat,
        bounds.getSouthWest().lng,
        bounds.getSouthWest().lat,
        bounds.getNorthEast().lng
    );
    
    const height = calcHaversineDistance(
        bounds.getSouthWest().lat,
        bounds.getSouthWest().lng,
        bounds.getNorthEast().lat,
        bounds.getSouthWest().lng
    );
    
    return (width * height) / 1000000; // Convert from square meters to square kilometers
}

/**
 * Calculate the Haversine distance between two points
 * @param {number} lat1 - Latitude of point 1
 * @param {number} lon1 - Longitude of point 1
 * @param {number} lat2 - Latitude of point 2
 * @param {number} lon2 - Longitude of point 2
 * @returns {number} Distance in meters
 */
function calcHaversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth's radius in meters
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distance = R * c;
    
    return distance;
}

/**
 * Convert degrees to radians
 * @param {number} degrees - Value in degrees
 * @returns {number} Value in radians
 */
function toRad(degrees) {
    return degrees * Math.PI / 180;
}

/**
 * Show an alert message
 * @param {string} message - The message to display
 */
function showAlert(message) {
    const alertContainer = document.getElementById('alertContainer');
    const alertText = document.getElementById('alertText');
    
    alertText.textContent = message;
    alertContainer.classList.remove('d-none');
    
    // Set up the close button
    document.getElementById('alertClose').addEventListener('click', hideAlert);
}

/**
 * Hide the alert message
 */
function hideAlert() {
    const alertContainer = document.getElementById('alertContainer');
    alertContainer.classList.add('d-none');
}

/**
 * Analyze the selected area
 */
function analyzeSelectedArea() {
    if (!selectedArea) {
        showAlert('Please select an area on the map first.');
        return;
    }
    
    // Get the bounds of the selected area
    const bounds = selectedArea.getBounds();
    const maxArea = parseFloat(document.getElementById('maxAreaInput').value);
    
    // Prepare the data for the API request
    const data = {
        bounds: {
            north: bounds.getNorth(),
            south: bounds.getSouth(),
            east: bounds.getEast(),
            west: bounds.getWest()
        },
        max_area: maxArea
    };
    
    // Show loading spinner
    document.getElementById('loadingSpinner').style.display = 'block';
    
    // Send the data to the backend
    fetch('/process_area', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        return response.json();
    })
    .then(results => {
        // Hide loading spinner
        document.getElementById('loadingSpinner').style.display = 'none';
        
        // Check if there's an error
        if (results.error) {
            showAlert(results.error);
            return;
        }
        
        // Display the results
        displayResults(results);
    })
    .catch(error => {
        // Hide loading spinner
        document.getElementById('loadingSpinner').style.display = 'none';
        
        // Show error alert
        showAlert(`Error: ${error.message}`);
        console.error('Error:', error);
    });
}

/**
 * Display the analysis results
 * @param {Object} results - The analysis results
 */
function displayResults(results) {
    // Clear previous rooftop layers
    clearRooftopLayers();
    
    // Show results container
    document.getElementById('results-container').style.display = 'block';
    
    // Update summary statistics
    document.getElementById('rooftopCount').textContent = results.count;
    document.getElementById('totalArea').textContent = results.total_area.toFixed(1);
    document.getElementById('avgSize').textContent = results.statistics.avg_area.toFixed(1);
    document.getElementById('potentialCapacity').textContent = results.statistics.potential_capacity.toFixed(1);
    
    // Update size distribution chart
    updateSizeDistributionChart(results.statistics.area_distribution);
    
    // Update rooftops table
    updateRooftopsTable(results.rooftops);
    
    // Display rooftops on the map
    displayRooftopsOnMap(results.rooftops);
}

/**
 * Clear all rooftop layers from the map
 */
function clearRooftopLayers() {
    for (const layer of rooftopLayers) {
        map.removeLayer(layer);
    }
    rooftopLayers = [];
}

/**
 * Update the size distribution chart
 * @param {Array} distribution - The size distribution data
 */
function updateSizeDistributionChart(distribution) {
    const ctx = document.getElementById('sizeDistChart').getContext('2d');
    
    // Destroy previous chart if it exists
    if (sizeDistributionChart) {
        sizeDistributionChart.destroy();
    }
    
    // Prepare data for the chart
    const labels = distribution.map(item => item.range);
    const data = distribution.map(item => item.count);
    
    // Create new chart
    sizeDistributionChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Number of Rooftops',
                data: data,
                backgroundColor: 'rgba(75, 192, 192, 0.7)',
                borderColor: 'rgba(75, 192, 192, 1)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Count'
                    },
                    ticks: {
                        precision: 0
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: 'Rooftop Size'
                    }
                }
            }
        }
    });
}

/**
 * Update the rooftops table
 * @param {Array} rooftops - The rooftops data
 */
function updateRooftopsTable(rooftops) {
    const tableBody = document.getElementById('rooftopsTable');
    tableBody.innerHTML = '';
    
    for (const rooftop of rooftops) {
        const row = document.createElement('tr');
        
        // Create ID cell (shortened)
        const idCell = document.createElement('td');
        idCell.textContent = rooftop.id.substring(0, 8) + '...';
        idCell.title = rooftop.id;
        row.appendChild(idCell);
        
        // Create area cell
        const areaCell = document.createElement('td');
        areaCell.textContent = rooftop.area.toFixed(1);
        row.appendChild(areaCell);
        
        // Create confidence cell
        const confCell = document.createElement('td');
        confCell.textContent = (rooftop.confidence * 100).toFixed(1) + '%';
        row.appendChild(confCell);
        
        // Create actions cell
        const actionsCell = document.createElement('td');
        const viewBtn = document.createElement('button');
        viewBtn.className = 'btn btn-sm btn-outline-info';
        viewBtn.innerHTML = '<i class="fas fa-eye"></i>';
        viewBtn.title = 'View on map';
        viewBtn.addEventListener('click', () => {
            // Center map on this rooftop
            map.setView([rooftop.centroid[0], rooftop.centroid[1]], 18);
            
            // Highlight this rooftop
            highlightRooftop(rooftop.id);
        });
        actionsCell.appendChild(viewBtn);
        row.appendChild(actionsCell);
        
        tableBody.appendChild(row);
    }
}

/**
 * Display rooftops on the map
 * @param {Array} rooftops - The rooftops data
 */
function displayRooftopsOnMap(rooftops) {
    for (const rooftop of rooftops) {
        // Format coordinates for Leaflet (swap lat/lng)
        const coords = rooftop.coordinates.map(coord => [coord[1], coord[0]]);
        
        // Create a polygon for the rooftop
        const polygon = L.polygon(coords, {
            color: '#3388ff',
            weight: 2,
            opacity: 0.8,
            fillColor: '#3388ff',
            fillOpacity: 0.5,
            rooftopId: rooftop.id
        });
        
        // Add popup with information
        polygon.bindPopup(`
            <strong>Rooftop ID:</strong> ${rooftop.id.substring(0, 8)}...<br>
            <strong>Area:</strong> ${rooftop.area.toFixed(1)} m²<br>
            <strong>Confidence:</strong> ${(rooftop.confidence * 100).toFixed(1)}%<br>
            <strong>Potential PV Capacity:</strong> ${(rooftop.area * 0.15).toFixed(1)} kW
        `);
        
        // Add event listeners
        polygon.on('mouseover', function() {
            this.setStyle({
                weight: 3,
                color: '#ff7800',
                fillOpacity: 0.7
            });
        });
        
        polygon.on('mouseout', function() {
            this.setStyle({
                weight: 2,
                color: '#3388ff',
                fillOpacity: 0.5
            });
        });
        
        // Add to map and store in array
        polygon.addTo(map);
        rooftopLayers.push(polygon);
    }
}

/**
 * Highlight a specific rooftop on the map
 * @param {string} rooftopId - The ID of the rooftop to highlight
 */
function highlightRooftop(rooftopId) {
    // Reset all rooftops
    for (const layer of rooftopLayers) {
        layer.setStyle({
            weight: 2,
            color: '#3388ff',
            fillOpacity: 0.5
        });
    }
    
    // Highlight the selected rooftop
    for (const layer of rooftopLayers) {
        if (layer.options.rooftopId === rooftopId) {
            layer.setStyle({
                weight: 4,
                color: '#ff7800',
                fillOpacity: 0.8
            });
            layer.bringToFront();
            layer.openPopup();
            break;
        }
    }
}

/**
 * Clear the map and reset the analysis
 */
function clearMap() {
    // Clear drawn items
    drawnItems.clearLayers();
    selectedArea = null;
    
    // Clear rooftop layers
    clearRooftopLayers();
    
    // Hide results container
    document.getElementById('results-container').style.display = 'none';
    
    // Disable analyze button
    document.getElementById('analyzeBtn').disabled = true;
    
    // Hide any alerts
    hideAlert();
}


