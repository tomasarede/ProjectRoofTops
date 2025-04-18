// Global variables
let map;
let drawingManager;
let selectedArea = null;
let rooftopLayers = [];
let sizeDistributionChart = null;

/**
 * Initialize the Google Map
 * @param {Object} bounds - The bounds of Portugal
 */
function initMap(bounds) {
    // Create Portugal bounds
    const portugalBounds = new google.maps.LatLngBounds(
        new google.maps.LatLng(bounds.south, bounds.west),
        new google.maps.LatLng(bounds.north, bounds.east)
    );
    
    // Create the map centered on Portugal
    map = new google.maps.Map(document.getElementById('map'), {
        center: { lat: (bounds.north + bounds.south) / 2, lng: (bounds.east + bounds.west) / 2 },
        zoom: 7,
        minZoom: 3,
        maxZoom: 22,
        mapTypeId: google.maps.MapTypeId.ROADMAP,
        mapTypeControl: true,
        mapTypeControlOptions: {
            style: google.maps.MapTypeControlStyle.HORIZONTAL_BAR,
            position: google.maps.ControlPosition.TOP_RIGHT,
            mapTypeIds: [
                google.maps.MapTypeId.ROADMAP,
                google.maps.MapTypeId.SATELLITE,
                google.maps.MapTypeId.HYBRID
            ]
        },
        streetViewControl: false,
        fullscreenControl: true,
        styles: [
            // Dark theme styles
            { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
            { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
            { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
            {
                featureType: "administrative.locality",
                elementType: "labels.text.fill",
                stylers: [{ color: "#d59563" }],
            },
            {
                featureType: "poi",
                elementType: "labels.text.fill",
                stylers: [{ color: "#d59563" }],
            },
            {
                featureType: "poi.park",
                elementType: "geometry",
                stylers: [{ color: "#263c3f" }],
            },
            {
                featureType: "poi.park",
                elementType: "labels.text.fill",
                stylers: [{ color: "#6b9a76" }],
            },
            {
                featureType: "road",
                elementType: "geometry",
                stylers: [{ color: "#38414e" }],
            },
            {
                featureType: "road",
                elementType: "geometry.stroke",
                stylers: [{ color: "#212a37" }],
            },
            {
                featureType: "road",
                elementType: "labels.text.fill",
                stylers: [{ color: "#9ca5b3" }],
            },
            {
                featureType: "road.highway",
                elementType: "geometry",
                stylers: [{ color: "#746855" }],
            },
            {
                featureType: "road.highway",
                elementType: "geometry.stroke",
                stylers: [{ color: "#1f2835" }],
            },
            {
                featureType: "road.highway",
                elementType: "labels.text.fill",
                stylers: [{ color: "#f3d19c" }],
            },
            {
                featureType: "transit",
                elementType: "geometry",
                stylers: [{ color: "#2f3948" }],
            },
            {
                featureType: "transit.station",
                elementType: "labels.text.fill",
                stylers: [{ color: "#d59563" }],
            },
            {
                featureType: "water",
                elementType: "geometry",
                stylers: [{ color: "#17263c" }],
            },
            {
                featureType: "water",
                elementType: "labels.text.fill",
                stylers: [{ color: "#515c6d" }],
            },
            {
                featureType: "water",
                elementType: "labels.text.stroke",
                stylers: [{ color: "#17263c" }],
            },
        ]
    });
    
    // Fit the map to Portugal bounds
    map.fitBounds(portugalBounds);
    
    // Add a search box
    const input = document.createElement('input');
    input.placeholder = 'Search for a location...';
    input.className = 'form-control';
    input.style.margin = '10px';
    input.style.width = '250px';
    
    const searchBox = new google.maps.places.SearchBox(input);
    map.controls[google.maps.ControlPosition.TOP_LEFT].push(input);
    
    // Bias the SearchBox results towards current map's viewport
    map.addListener('bounds_changed', () => {
        searchBox.setBounds(map.getBounds());
    });
    
    // Listen for the event fired when the user selects a prediction and retrieve more details
    searchBox.addListener('places_changed', () => {
        const places = searchBox.getPlaces();
        
        if (places.length === 0) {
            return;
        }
        
        // For each place, get the icon, name and location
        const bounds = new google.maps.LatLngBounds();
        places.forEach(place => {
            if (!place.geometry || !place.geometry.location) {
                console.log("Returned place contains no geometry");
                return;
            }
            
            if (place.geometry.viewport) {
                // Only geocodes have viewport
                bounds.union(place.geometry.viewport);
            } else {
                bounds.extend(place.geometry.location);
            }
        });
        map.fitBounds(bounds);
    });
    
    // Initialize the drawing manager
    drawingManager = new google.maps.drawing.DrawingManager({
        drawingMode: null,
        drawingControl: true,
        drawingControlOptions: {
            position: google.maps.ControlPosition.TOP_CENTER,
            drawingModes: [
                google.maps.drawing.OverlayType.RECTANGLE,
                google.maps.drawing.OverlayType.POLYGON
            ]
        },
        rectangleOptions: {
            fillColor: '#4e73df',
            fillOpacity: 0.3,
            strokeWeight: 2,
            strokeColor: '#4e73df',
            clickable: true,
            editable: true,
            zIndex: 1
        },
        polygonOptions: {
            fillColor: '#4e73df',
            fillOpacity: 0.3,
            strokeWeight: 2,
            strokeColor: '#4e73df',
            clickable: true,
            editable: true,
            zIndex: 1
        }
    });
    
    drawingManager.setMap(map);
    
    // Add listeners for drawing events
    google.maps.event.addListener(drawingManager, 'overlaycomplete', function(event) {
        // Switch drawing mode to non-drawing after completing a shape
        drawingManager.setDrawingMode(null);
        
        // Set the selected area
        if (selectedArea) {
            selectedArea.setMap(null);
        }
        selectedArea = event.overlay;
        
        // Update area info and enable analyze button
        updateAreaInfo(selectedArea);
        document.getElementById('analyzeBtn').disabled = false;
        
        // Add listeners for editing the shape
        if (event.type === google.maps.drawing.OverlayType.RECTANGLE) {
            google.maps.event.addListener(selectedArea, 'bounds_changed', function() {
                updateAreaInfo(selectedArea);
            });
        } else if (event.type === google.maps.drawing.OverlayType.POLYGON) {
            google.maps.event.addListener(selectedArea.getPath(), 'set_at', function() {
                updateAreaInfo(selectedArea);
            });
            google.maps.event.addListener(selectedArea.getPath(), 'insert_at', function() {
                updateAreaInfo(selectedArea);
            });
            google.maps.event.addListener(selectedArea.getPath(), 'remove_at', function() {
                updateAreaInfo(selectedArea);
            });
        }
    });
    
    // Add event listeners for the analyze button
    document.getElementById('analyzeBtn').addEventListener('click', analyzeSelectedArea);
    
    // Add event listener for the clear button
    document.getElementById('clearBtn').addEventListener('click', clearMap);
}

/**
 * Update area information based on the selected shape
 * @param {google.maps.Rectangle|google.maps.Polygon} shape - The selected shape
 */
function updateAreaInfo(shape) {
    let bounds;
    
    if (shape instanceof google.maps.Rectangle) {
        bounds = shape.getBounds();
    } else if (shape instanceof google.maps.Polygon) {
        bounds = new google.maps.LatLngBounds();
        const path = shape.getPath();
        path.forEach(latLng => {
            bounds.extend(latLng);
        });
    }
    
    const areaSqKm = calculateAreaInSqKm(shape);
    
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
 * Calculate the area of a shape in square kilometers
 * @param {google.maps.Rectangle|google.maps.Polygon} shape - The shape to calculate the area for
 * @returns {number} Area in square kilometers
 */
function calculateAreaInSqKm(shape) {
    let area = 0;
    
    if (shape instanceof google.maps.Rectangle) {
        const bounds = shape.getBounds();
        const ne = bounds.getNorthEast();
        const sw = bounds.getSouthWest();
        
        // Calculate width in meters
        const width = google.maps.geometry.spherical.computeDistanceBetween(
            new google.maps.LatLng(sw.lat(), sw.lng()),
            new google.maps.LatLng(sw.lat(), ne.lng())
        );
        
        // Calculate height in meters
        const height = google.maps.geometry.spherical.computeDistanceBetween(
            new google.maps.LatLng(sw.lat(), sw.lng()),
            new google.maps.LatLng(ne.lat(), sw.lng())
        );
        
        area = (width * height) / 1000000; // Convert to sq km
    } else if (shape instanceof google.maps.Polygon) {
        // Get area in square meters
        area = google.maps.geometry.spherical.computeArea(shape.getPath());
        area = area / 1000000; // Convert to sq km
    }
    
    return area;
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
    let bounds;
    if (selectedArea instanceof google.maps.Rectangle) {
        bounds = selectedArea.getBounds();
        bounds = {
            north: bounds.getNorthEast().lat(),
            east: bounds.getNorthEast().lng(),
            south: bounds.getSouthWest().lat(),
            west: bounds.getSouthWest().lng()
        };
    } else if (selectedArea instanceof google.maps.Polygon) {
        const path = selectedArea.getPath();
        const googleBounds = new google.maps.LatLngBounds();
        path.forEach(latLng => {
            googleBounds.extend(latLng);
        });
        bounds = {
            north: googleBounds.getNorthEast().lat(),
            east: googleBounds.getNorthEast().lng(),
            south: googleBounds.getSouthWest().lat(),
            west: googleBounds.getSouthWest().lng()
        };
    }
    
    const maxArea = parseFloat(document.getElementById('maxAreaInput').value);
    
    // Prepare the data for the API request
    const data = {
        bounds: bounds,
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
        layer.setMap(null);
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
    
    rooftops.forEach((rooftop, index) => {
        const row = document.createElement('tr');
        row.classList.add('rooftop-row');
        row.setAttribute('data-rooftop-id', rooftop.id);
        
        // Create sequential number cell instead of ID
        const numCell = document.createElement('td');
        numCell.textContent = `#${index + 1}`;
        numCell.className = 'text-center';
        row.appendChild(numCell);
        
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
        viewBtn.className = 'btn btn-sm btn-outline-info action-btn';
        viewBtn.innerHTML = '<i class="fas fa-eye"></i>';
        viewBtn.title = 'View on map';
        viewBtn.addEventListener('click', () => {
            // Center map on this rooftop
            map.setCenter(new google.maps.LatLng(rooftop.centroid[0], rooftop.centroid[1]));
            map.setZoom(18);
            
            // Highlight this rooftop
            highlightRooftop(rooftop.id);
        });
        actionsCell.appendChild(viewBtn);
        
        // Add a details button
        const detailsBtn = document.createElement('button');
        detailsBtn.className = 'btn btn-sm btn-outline-primary action-btn ms-1';
        detailsBtn.innerHTML = '<i class="fas fa-info-circle"></i>';
        detailsBtn.title = 'Show details';
        detailsBtn.addEventListener('click', () => {
            // Show rooftop details in a tooltip or small modal
            const detailsHtml = `
                <div class="rooftop-details">
                    <h6>Rooftop #${index + 1} Details</h6>
                    <p><strong>Area:</strong> ${rooftop.area.toFixed(1)} m²</p>
                    <p><strong>Confidence:</strong> ${(rooftop.confidence * 100).toFixed(1)}%</p>
                    <p><strong>Potential PV Capacity:</strong> ${(rooftop.area * 0.15).toFixed(1)} kW</p>
                </div>
            `;
            
            // Create and show info window
            const infowindow = new google.maps.InfoWindow({
                content: detailsHtml
            });
            
            infowindow.setPosition({
                lat: rooftop.centroid[0],
                lng: rooftop.centroid[1]
            });
            
            infowindow.open(map);
        });
        actionsCell.appendChild(detailsBtn);
        
        row.appendChild(actionsCell);
        
        // Highlight row on hover
        row.addEventListener('mouseenter', () => {
            highlightRooftop(rooftop.id);
        });
        
        row.addEventListener('mouseleave', () => {
            if (!selectedRooftopId) {
                resetRooftopHighlights();
            }
        });
        
        tableBody.appendChild(row);
    });
}

/**
 * Display rooftops on the map
 * @param {Array} rooftops - The rooftops data
 */
function displayRooftopsOnMap(rooftops) {
    // Clear existing rooftop layers first
    clearRooftopLayers();
    
    // Define a gradient of colors for better visual distinction
    const colorGradient = [
        '#4e73df', // Blue
        '#1cc88a', // Green
        '#f6c23e', // Yellow
        '#e74a3b', // Red
        '#8e44ad', // Purple
        '#3498db', // Light Blue
        '#2ecc71', // Emerald
        '#e67e22', // Orange
        '#f1c40f'  // Sunny Yellow
    ];
    
    rooftops.forEach((rooftop, index) => {
        // Create polygon coordinates - Handle both array format and object format
        const coordinates = rooftop.coordinates.map(coord => {
            // Check if coord is an array [lat, lng] or object {lat, lng}
            if (Array.isArray(coord)) {
                return { lat: coord[0], lng: coord[1] };
            } else if (typeof coord === 'object') {
                return coord; // Already in {lat, lng} format
            }
        });
        
        // Select color from gradient based on index
        const colorIndex = index % colorGradient.length;
        const color = colorGradient[colorIndex];
        
        // Create polygon for the rooftop with more modern styling
        const polygon = new google.maps.Polygon({
            paths: coordinates,
            strokeColor: color,
            strokeOpacity: 0.9,
            strokeWeight: 2,
            fillColor: color,
            fillOpacity: 0.6,
            rooftopId: rooftop.id,
            rooftopIndex: index + 1, // Store the sequential number
            zIndex: 10 // Ensure rooftops are above the selected area
        });
        
        // Add label with rooftop number
        const center = getPolygonCenter(coordinates);
        const label = new google.maps.Marker({
            position: center,
            map: map,
            label: {
                text: `${index + 1}`,
                color: 'white',
                fontSize: '10px',
                fontWeight: 'bold'
            },
            icon: {
                path: google.maps.SymbolPath.CIRCLE,
                fillColor: color,
                fillOpacity: 0.9,
                strokeWeight: 0,
                scale: 10
            },
            clickable: false
        });
        
        // Add info window content
        const infowindow = new google.maps.InfoWindow({
            content: `
                <div class="rooftop-details">
                    <h6>Rooftop #${index + 1}</h6>
                    <p><strong>Area:</strong> ${rooftop.area.toFixed(1)} m²</p>
                    <p><strong>Confidence:</strong> ${(rooftop.confidence * 100).toFixed(1)}%</p>
                    <p><strong>Potential PV Capacity:</strong> ${(rooftop.area * 0.15).toFixed(1)} kW</p>
                </div>
            `
        });
        
        // Add click listener to show info window
        polygon.addListener('click', function() {
            infowindow.setPosition(center);
            infowindow.open(map);
            highlightRooftop(rooftop.id);
            
            // Highlight the corresponding table row
            const rows = document.querySelectorAll('.rooftop-row');
            rows.forEach(row => {
                if (row.getAttribute('data-rooftop-id') === rooftop.id) {
                    row.classList.add('table-active');
                    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
                } else {
                    row.classList.remove('table-active');
                }
            });
        });
        
        // Add hover effects
        polygon.addListener('mouseover', function() {
            this.setOptions({
                strokeWeight: 3,
                strokeColor: '#ff7800',
                fillOpacity: 0.8
            });
        });
        
        polygon.addListener('mouseout', function() {
            if (this.rooftopId !== selectedRooftopId) {
                this.setOptions({
                    strokeWeight: 2,
                    strokeColor: color,
                    fillOpacity: 0.6
                });
            }
        });
        
        // Add to map and store in array
        polygon.setMap(map);
        rooftopLayers.push(polygon);
        
        // Store the label in the layers array too for clearing
        rooftopLayers.push(label);
    });
}

/**
 * Calculate the center point of a polygon for label placement
 * @param {Array} coordinates - Array of coordinate points
 * @returns {Object} Center point as LatLng
 */
function getPolygonCenter(coordinates) {
    // Simple average for approximate center
    let lat = 0;
    let lng = 0;
    
    coordinates.forEach(coord => {
        lat += coord.lat;
        lng += coord.lng;
    });
    
    return {
        lat: lat / coordinates.length,
        lng: lng / coordinates.length
    };
}

/**
 * Reset all rooftop highlights
 */
function resetRooftopHighlights() {
    selectedRooftopId = null;
    
    // Reset all polygons to their default style
    for (const layer of rooftopLayers) {
        if (layer instanceof google.maps.Polygon) {
            const colorIndex = (layer.rooftopIndex - 1) % 9;
            const color = [
                '#4e73df', // Blue
                '#1cc88a', // Green
                '#f6c23e', // Yellow
                '#e74a3b', // Red
                '#8e44ad', // Purple
                '#3498db', // Light Blue
                '#2ecc71', // Emerald
                '#e67e22', // Orange
                '#f1c40f'  // Sunny Yellow
            ][colorIndex];
            
            layer.setOptions({
                strokeWeight: 2,
                strokeColor: color,
                fillOpacity: 0.6
            });
        }
    }
    
    // Remove active class from all table rows
    document.querySelectorAll('.rooftop-row').forEach(row => {
        row.classList.remove('table-active');
    });
}

// Keep track of currently highlighted rooftop
let selectedRooftopId = null;

/**
 * Highlight a specific rooftop on the map
 * @param {string} rooftopId - The ID of the rooftop to highlight
 */
function highlightRooftop(rooftopId) {
    selectedRooftopId = rooftopId;
    
    // Reset all polygons to their original colors
    resetRooftopHighlights();
    
    // Highlight the selected rooftop
    for (const layer of rooftopLayers) {
        if (layer instanceof google.maps.Polygon && layer.rooftopId === rooftopId) {
            layer.setOptions({
                strokeWeight: 4,
                strokeColor: '#ff7800',
                fillOpacity: 0.85,
                zIndex: 20 // Bring to front
            });
            
            // Also highlight the corresponding table row
            document.querySelectorAll('.rooftop-row').forEach(row => {
                if (row.getAttribute('data-rooftop-id') === rooftopId) {
                    row.classList.add('table-active');
                } else {
                    row.classList.remove('table-active');
                }
            });
            
            break;
        }
    }
}

/**
 * Clear the map and reset the analysis
 */
function clearMap() {
    // Remove selected area
    if (selectedArea) {
        selectedArea.setMap(null);
        selectedArea = null;
    }
    
    // Clear any rooftop layers
    clearRooftopLayers();
    
    // Hide results container
    document.getElementById('results-container').style.display = 'none';
    
    // Disable analyze button
    document.getElementById('analyzeBtn').disabled = true;
    
    // Clear any alerts
    hideAlert();
}