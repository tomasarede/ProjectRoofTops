/**
 * Initialize the dashboard
 */
function initDashboard() {
    // Add event listeners for the max area input
    const maxAreaInput = document.getElementById('maxAreaInput');
    maxAreaInput.addEventListener('change', function() {
        // Revalidate the selected area if one exists
        if (selectedArea) {
            updateAreaInfo(selectedArea);
        }
    });
    
    // Set up event listeners for the export buttons
    document.getElementById('exportGeoJSON').addEventListener('click', exportAsGeoJSON);
    document.getElementById('exportCSV').addEventListener('click', exportAsCSV);
    
    // Initialize charts with empty data
    initializeCharts();
}

/**
 * Initialize charts with empty data
 */
function initializeCharts() {
    // Size distribution chart
    const sizeDistCtx = document.getElementById('sizeDistChart').getContext('2d');
    sizeDistributionChart = new Chart(sizeDistCtx, {
        type: 'bar',
        data: {
            labels: ['0-5 m²', '5-10 m²', '10-15 m²', '15-20 m²', '>20 m²'],
            datasets: [{
                label: 'Number of Rooftops',
                data: [0, 0, 0, 0, 0],
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
