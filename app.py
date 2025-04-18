import os
import json
from flask import Flask, render_template, request, jsonify
from werkzeug.middleware.proxy_fix import ProxyFix
from yolo_model import YoloModel
from gis_utils import process_area, get_portugal_bounds, calculate_area_size
from extensions import logger
from dotenv import load_dotenv


load_dotenv()  # reads .env into os.environ

# Initialize Flask app
app = Flask(__name__)
app.secret_key = os.environ.get("SESSION_SECRET", "dev_secret_key")
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)

# Database functionality disabled per user request

# Initialize YOLO model
yolo_model = YoloModel()

@app.route('/')
def index():
    """Render the main dashboard page"""
    portugal_bounds = get_portugal_bounds()
    return render_template('index.html', portugal_bounds=portugal_bounds)

@app.route('/process_area', methods=['POST'])
def analyze_area():
    """Process the selected area with the YOLO model"""
    try:
        data = request.get_json()
        bounds = data.get('bounds')
        max_area = data.get('max_area', 20)  # Default max area is 20 km²

        logger.debug(f"Processing area with bounds: {bounds} and max area: {max_area}")

        # Validate input
        if not bounds:
            return jsonify({"error": "No area selected"}), 400

        # Calculate area size in square kilometers
        area_size = calculate_area_size(bounds)
        
        # Check if area is too large
        if area_size > max_area:
            return jsonify({
                "error": f"Selected area ({area_size:.2f} km²) exceeds maximum allowed area ({max_area} km²)",
                "area_size": area_size,
                "max_area": max_area
            }), 400

        # Process the selected area
        results = process_area(bounds, max_area, yolo_model)
        # Database functionality disabled per user request
        
        return jsonify(results)
    
    except Exception as e:
        logger.error(f"Error processing area: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/model_info')
def model_info():
    """Return information about the YOLO model"""
    return jsonify({
        "name": yolo_model.name,
        "version": yolo_model.version,
        "status": "loaded" if yolo_model.model_loaded else "not loaded"
    })

@app.route('/api/pv_analytics', methods=['POST'])
def pv_analytics():
    """Calculate detailed PV analytics for the detected rooftops"""
    try:
        data = request.get_json()
        total_area = data.get('total_area', 0)
        rooftop_count = data.get('rooftop_count', 0)
        capacity = data.get('capacity', 0)
        
        # Monthly production factors for Portugal (percentage of annual production)
        monthly_factors = [0.06, 0.07, 0.09, 0.10, 0.11, 0.12, 0.13, 0.12, 0.10, 0.07, 0.06, 0.05]
        annual_production = capacity * 1500  # 1500kWh per kWp in Portugal
        monthly_production = [round(annual_production * factor) for factor in monthly_factors]
        
        # Calculate other metrics
        panel_count = round(capacity * 1000 / 400)  # 400W panels
        installation_cost = round(capacity * 1000 * 1.2)  # €1.2 per watt
        annual_savings = round(annual_production * 0.15)  # €0.15 per kWh
        payback_period = round((installation_cost / annual_savings) * 10) / 10
        lifetime_benefit = round(annual_savings * 25 - installation_cost)
        co2_reduction = round(annual_production * 0.4)  # 0.4kg CO2 per kWh
        trees_equivalent = round(co2_reduction / 20)  # 20kg CO2 per tree per year
        car_equivalent = round(co2_reduction * 6)  # 6km per kg CO2
        fossil_fuel_saved = round(annual_production * 0.2)  # 0.2kg fossil fuel per kWh
        
        return jsonify({
            "success": True,
            "analytics": {
                "capacity": capacity,
                "rooftop_count": rooftop_count,
                "total_area": total_area,
                "panel_count": panel_count,
                "monthly_production": monthly_production,
                "annual_production": annual_production,
                "daily_production": round(annual_production / 365),
                "installation_cost": installation_cost,
                "annual_savings": annual_savings,
                "payback_period": payback_period,
                "lifetime_benefit": lifetime_benefit,
                "co2_reduction": co2_reduction,
                "trees_equivalent": trees_equivalent,
                "car_equivalent": car_equivalent,
                "fossil_fuel_saved": fossil_fuel_saved,
                "system_efficiency": 17,
                "inverter_size": round(capacity * 0.9 * 10) / 10
            }
        })
    except Exception as e:
        logger.error(f"Error calculating PV analytics: {str(e)}")
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    # Database functionality disabled per user request
    app.run(host='0.0.0.0', port=5000, debug=True)
