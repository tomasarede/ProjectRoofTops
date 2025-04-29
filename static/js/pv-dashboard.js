/*
Energy Services Course - IST - April 2025

Diogo Franco ist1103276
João Santos ist1103243
Tomás Arêde ist1103239
*/

let map;
let searchBox;
let currentCenter;
let currentZoom;
let powerChart;
let rooftopData = [];

function initializeMap() {
  // Create the map centered on Portugal
  map = new google.maps.Map(document.getElementById('map'), {
    center: {lat: 39.3999, lng: -8.2245},
    zoom: 5,
    mapTypeId: 'satellite',
    streetViewControl: false,
    rotateControl: false,
    tilt: 0,
    mapTypeControl: true,
    mapTypeControlOptions: {
      style: google.maps.MapTypeControlStyle.DROPDOWN_MENU,
      mapTypeIds: ['roadmap', 'hybrid', 'satellite']
    }
  });

  // Set up place search
  const searchInput = document.getElementById('search-input');
  searchBox = new google.maps.places.SearchBox(searchInput);
  searchBox.addListener('places_changed', () => {
    const places = searchBox.getPlaces();
    if (!places.length) return;
    const place = places[0];
    if (!place.geometry) return;
    map.panTo(place.geometry.location);
    map.setZoom(17);
  });

  // UI Elements
  const captureButton = document.getElementById('printBtn');
  const zoomWarningElement = document.getElementById('zoom-warning');
  const zoomLevelElement = document.getElementById('zoom-level');
  const coordinatesElement = document.getElementById('coords');
  const resultImage = document.getElementById('resultImg');
  const resultPlaceholder = document.getElementById('result-placeholder');
  const loadingOverlay = document.getElementById('loading-overlay');
  const detectionStatus = document.getElementById('detection-status');
  const totalSummaryCard = document.getElementById('total-summary-card');
  const rooftopDetailCard = document.getElementById('rooftop-detail-card');

  // Update map state on idle
  map.addListener('idle', () => {
    currentCenter = map.getCenter();
    currentZoom = map.getZoom();

    zoomLevelElement.textContent = `Zoom: ${currentZoom}`;
    coordinatesElement.textContent = `Lat: ${currentCenter.lat().toFixed(5)} | Lng: ${currentCenter.lng().toFixed(5)}`;

    if (currentZoom >= 19) {
      captureButton.disabled = false;
      zoomWarningElement.classList.remove('show');
      detectionStatus.textContent = "Ready for analysis";
      detectionStatus.classList.replace('text-danger', 'text-muted');
    } else {
      captureButton.disabled = true;
      zoomWarningElement.classList.add('show');
      detectionStatus.textContent = "Zoom required";
      detectionStatus.classList.replace('text-muted', 'text-danger');
    }
  });

  // Handle capture click
  captureButton.addEventListener('click', () => {
    if (!currentCenter || currentZoom < 19) return;

    loadingOverlay.classList.add('active');
    detectionStatus.textContent = "Analyzing...";
    detectionStatus.classList.replace('text-muted', 'text-primary');

    resultPlaceholder.style.display = 'none';
    totalSummaryCard.style.display = 'none';
    rooftopDetailCard.style.display = 'none';

    fetch('/capture', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        lat: currentCenter.lat(),
        lng: currentCenter.lng(),
        zoom: currentZoom,
        size: '600x600'  // Square image

      })
    })
    .then(response => {
      if (!response.ok) throw new Error('Capture failed');
      return response.json();
    })
    .then(data => {
      loadingOverlay.classList.remove('active');
      resultImage.src = data.image_path;
      resultImage.style.display = 'block';
      detectionStatus.textContent = "Analysis complete";
      detectionStatus.classList.replace('text-primary', 'text-success');

      // Store rooftop data
      rooftopData = data.rooftop_data;
      
      // Display summary and rooftop selection
      displaySummaryData(rooftopData);
      populateRooftopSelect(rooftopData);
      
      if (rooftopData.length > 0) {
        // Show the first rooftop details by default
        displayRooftopDetail(rooftopData[0], 0);
        
        // Update the selector to show the first rooftop
        document.getElementById('rooftop-select').value = "0";
      }
    })
    .catch(error => {
      console.error(error);
      loadingOverlay.classList.remove('active');
      detectionStatus.textContent = "Analysis failed";
      detectionStatus.classList.replace('text-primary', 'text-danger');
      resultPlaceholder.style.display = 'flex';
      resultPlaceholder.innerHTML = `
        <i class="bi bi-exclamation-triangle-fill text-danger"></i>
        <p>Failed to analyze rooftops</p>
        <p class="text-muted small">Please try again or select a different area</p>
      `;
    });
  });
}

function displaySummaryData(rooftops) {
  const totalSummaryCard = document.getElementById('total-summary-card');
  
  if (!rooftops.length) {
    totalSummaryCard.style.display = 'none';
    return;
  }
  
  // Calculate totals
  let totalCapacity = 0;
  let totalAnnualOutput = 0;
  let totalCO2Savings = 0;
  let totalCost = 0;
  let totalAnnualSavings = 0;
  
  rooftops.forEach(roof => {
    totalCapacity += roof.capacity_kw;
    totalAnnualOutput += roof.kwh_per_year;
    totalCO2Savings += roof.co2_savings_kg;
    totalCost += roof.installation_cost;
    totalAnnualSavings += roof.annual_savings;
  });
  
  // Update UI
  document.getElementById('total-capacity').textContent = totalCapacity.toFixed(2) + ' kW';
  document.getElementById('total-annual-output').textContent = formatNumber(totalAnnualOutput) + ' kWh';
  document.getElementById('total-co2-savings').textContent = formatNumber(totalCO2Savings) + ' kg';
  document.getElementById('total-cost').textContent = '$' + formatNumber(totalCost);
  document.getElementById('total-annual-savings').textContent = '$' + formatNumber(totalAnnualSavings);
  
  // Show the summary card
  totalSummaryCard.style.display = 'block';
}

function populateRooftopSelect(rooftops) {
  const select = document.getElementById('rooftop-select');
  
  // Clear previous options
  select.innerHTML = '<option value="">Select a rooftop to view details</option>';
  
  if (!rooftops.length) {
    select.style.display = 'none';
    return;
  }
  
  // Add options for each rooftop
  rooftops.forEach((roof, index) => {
    const option = document.createElement('option');
    option.value = index;
    option.textContent = `Rooftop #${index + 1} (${roof.area_m2.toFixed(1)} m²)`;
    select.appendChild(option);
  });
  
  // Show select and add event listener
  select.style.display = 'block';
  
  // Add change event listener
  select.addEventListener('change', (e) => {
    const index = parseInt(e.target.value);
    if (!isNaN(index)) {
      displayRooftopDetail(rooftops[index], index);
    } else {
      // Hide detail card if "Select a rooftop" is chosen
      document.getElementById('rooftop-detail-card').style.display = 'none';
    }
  });
}

function displayRooftopDetail(rooftop, index) {
  const detailCard = document.getElementById('rooftop-detail-card');
  
  // Update title and data
  document.getElementById('rooftop-title').textContent = `Rooftop #${index + 1}`;
  document.getElementById('rooftop-area').textContent = `${rooftop.area_m2.toFixed(1)} m²`;
  document.getElementById('rooftop-capacity').textContent = `${rooftop.capacity_kw.toFixed(2)} kW`;
  document.getElementById('rooftop-modules').textContent = rooftop.modules;
  document.getElementById('rooftop-annual-output').textContent = `${formatNumber(rooftop.kwh_per_year)} kWh`;
  document.getElementById('rooftop-co2-savings').textContent = `${formatNumber(rooftop.co2_savings_kg)} kg`;
  document.getElementById('rooftop-cost').textContent = `$${formatNumber(rooftop.installation_cost)}`;
  
  // Generate charts
  generatePowerChart(rooftop.monthly_kwh);
  
  // Show the card
  detailCard.style.display = 'block';
}

function generatePowerChart(monthlyData) {
  const ctx = document.getElementById('powerChart').getContext('2d');
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ];

  if (powerChart) {
    powerChart.destroy();
  }

  // Calculate gradient
  const gradient = ctx.createLinearGradient(0, 0, 0, 400);
  gradient.addColorStop(0, 'rgba(77, 157, 224, 0.5)');
  gradient.addColorStop(1, 'rgba(77, 157, 224, 0.0)');

  powerChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: months,
      datasets: [{
        label: 'Expected Power Output (kWh)',
        data: monthlyData,
        borderColor: '#4d9de0',
        borderWidth: 3,
        backgroundColor: gradient,
        fill: true,
        tension: 0.4,
        pointBackgroundColor: '#ffffff',
        pointBorderColor: '#4d9de0',
        pointRadius: 4,
        pointHoverRadius: 6,
        pointHoverBackgroundColor: '#ffffff',
        pointHoverBorderColor: '#4d9de0',
        pointHoverBorderWidth: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        tooltip: {
          mode: 'index',
          intersect: false,
          backgroundColor: 'rgba(42, 44, 54, 0.95)',
          titleColor: '#ffffff',
          bodyColor: '#f5f5f7',
          borderColor: 'rgba(255, 255, 255, 0.1)',
          borderWidth: 1,
          padding: 12,
          boxPadding: 6,
          usePointStyle: true,
          titleFont: {
            weight: 600,
            size: 14,
            family: "'Inter', sans-serif"
          },
          bodyFont: {
            size: 13,
            family: "'Inter', sans-serif"
          },
          callbacks: {
            label: function(context) {
              return ` ${context.parsed.y} kWh`;
            }
          }
        },
        legend: {
          display: true,
          position: 'top',
          labels: {
            color: '#f5f5f7',
            font: {
              family: "'Inter', sans-serif",
              weight: 500,
              size: 12
            },
            padding: 16,
            usePointStyle: true,
            pointStyle: 'circle'
          }
        }
      },
      scales: {
        x: {
          grid: {
            color: 'rgba(255, 255, 255, 0.05)',
            tickLength: 8
          },
          ticks: {
            color: '#a7a7b3',
            font: {
              family: "'Inter', sans-serif",
              size: 12
            },
            padding: 10
          }
        },
        y: {
          beginAtZero: true,
          grid: {
            color: 'rgba(255, 255, 255, 0.05)',
            drawBorder: false
          },
          ticks: {
            color: '#a7a7b3',
            font: {
              family: "'Inter', sans-serif",
              size: 12
            },
            padding: 10,
            callback: function(value) {
              return value + ' kWh';
            }
          }
        }
      },
      hover: {
        mode: 'index',
        intersect: false
      },
      layout: {
        padding: {
          top: 20,
          right: 20,
          bottom: 0,
          left: 0
        }
      }
    }
  });
}

document.addEventListener('DOMContentLoaded', function() {
  
  // Mapping of metric ID to hardcoded explanation (your provided details)
  const calculationExplanations = {
    'total-capacity': `
      <h6><i class="bi bi-lightning"></i> Total Capacity (kW)</h6>
      <p>Calculated by:<br><b>Total Capacity = (Panel Power Rating × Number of Modules) / 1000</b></p>
      <p><br>Panel Power Rating: 400W<br>Number of Modules: Calculated from rooftop area divided by panel area (1.8m² per panel)</p>`,
    
    'total-annual-output': `
      <h6><i class="bi bi-battery-charging"></i> Total Annual Output (kWh)</h6>
      <p>Calculated by:<br><b>Annual Output = Σ(Monthly AC Output) × Number of Modules</b></p>
      <p><br>Calculated using PVLib with location-specific solar irradiance data<br>Includes temperature effects on panel efficiency<br>Assumes 30° tilt and 180° azimuth (south-facing)</p>`,
    
    'total-co2-savings': `
      <h6><i class="bi bi-tree"></i> Total CO₂ Savings (kg/year)</h6>
      <p>Calculated by:<br><b>CO₂ Savings = Annual Output × Grid CO₂ Intensity</b></p>
      <p><br>Grid CO₂ Intensity: 0.08 kg/kWh (Portugal average)<br>Based on displacement of grid electricity generation</p>`,
    
    'total-cost': `
      <h6><i class="bi bi-tools"></i> Total Installation Cost</h6>
      <p>Calculated by:<br><b>Installation Cost = Total Capacity × Cost per kW</b></p>
      <p><br>Cost per kW: 1500€ (Portugal market average)<br>Includes panels, inverters, and installation labor<br>Does not include potential subsidies or tax incentives</p>`,
    
    'total-annual-savings': `
      <h6><i class="bi bi-piggy-bank"></i> Total Annual Savings</h6>
      <p>Calculated by:<br><b>Annual Savings = Annual Output × Electricity Cost</b></p>
      <p><br>Electricity cost varies according to local energy tariffs but was used 0,24</p>`,
    
    // Rooftop Specific Metrics
    'rooftop-capacity': `
      <h6><i class="bi bi-lightning"></i> Rooftop Capacity (kW)</h6>
      <p>Calculated by:<br><b>System Size = Panel Area × Panel Efficiency × 1000</b></p>`,
    
    'rooftop-modules': `
      <h6><i class="bi bi-grid-3x3"></i> Number of Solar Panels</h6>
      <p>Calculated by:<br><b>Number of Modules = Rooftop Area / Panel Area</b></p>
      <p><br>Assuming standard panel size around 1.8m²</p>
      <p><br>Assuming only 20% of the identified area can be used.</p>`,
    
    'rooftop-annual-output': `
      <h6><i class="bi bi-battery-charging"></i> Rooftop Annual Output (kWh)</h6>
      <p>Calculated by:<br><b>Annual Output = Irradiance × System Size × Performance Ratio</b></p>`,
    
    'rooftop-co2-savings': `
      <h6><i class="bi bi-tree"></i> Rooftop CO₂ Savings (kg/year)</h6>
      <p>Calculated by:<br><b>CO₂ Savings = Annual Output × Grid CO₂ Intensity</b></p>`,
    
    'rooftop-cost': `
      <h6><i class="bi bi-tools"></i> Rooftop Installation Cost</h6>
      <p>Calculated by:<br><b>Installation Cost = Capacity × Cost per kW</b></p>`
  };

  // Attach click event to each metric-item
  document.querySelectorAll('.metric-item').forEach(item => {
    item.addEventListener('click', function() {
      const valueElement = this.querySelector('.metric-value');
      if (!valueElement) return;

      const metricId = valueElement.getAttribute('id');
      const explanation = calculationExplanations[metricId];
      const modalBody = document.getElementById('calculationModalBody');

      if (explanation) {
        modalBody.innerHTML = explanation;
        const modal = new bootstrap.Modal(document.getElementById('calculationModal'));
        modal.show();
      }
    });
  });

});


function formatNumber(num) {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(2) + 'M';
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  } else {
    return num.toFixed(0);
  }
}

document.addEventListener('DOMContentLoaded', initializeMap);