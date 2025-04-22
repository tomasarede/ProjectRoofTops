import os
import datetime
import math
import pandas as pd
from flask import Flask, render_template, request, jsonify
from werkzeug.middleware.proxy_fix import ProxyFix
from dotenv import load_dotenv
from extensions import logger
from yolo_model import YoloModel
from gis_utils import process_area, get_portugal_bounds, calculate_area_size

# ───────────────────────────────────────────────────────────
#  Attempt PVLib import
# ───────────────────────────────────────────────────────────
try:
    from pvlib import pvsystem, location, modelchain
    PVLIB_AVAILABLE = True
    logger.info("PVLib successfully imported")
except ImportError:
    PVLIB_AVAILABLE = False
    logger.warning("PVLib not available – simplified model will be used")

# ───────────────────────────────────────────────────────────
#  Flask setup
# ───────────────────────────────────────────────────────────
load_dotenv()
app = Flask(__name__)
app.secret_key = os.environ.get("SESSION_SECRET", "dev_secret_key")
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)
app.config["GOOGLE_MAPS_API_KEY"] = os.getenv("GOOGLE_MAPS_API_KEY")

@app.context_processor
def inject_google_key():
    return {"GOOGLE_MAPS_API_KEY": app.config["GOOGLE_MAPS_API_KEY"]}

# YOLO model
yolo_model = YoloModel()

# ───────────────────────────────────────────────────────────
#  ROUTES
# ───────────────────────────────────────────────────────────
@app.route('/')
def index():
    return render_template('index.html', portugal_bounds=get_portugal_bounds())

# ---------- Area processing ----------
@app.route('/process_area', methods=['POST'])
def analyze_area():
    try:
        data = request.get_json()
        bounds    = data.get('bounds')
        max_area  = data.get('max_area', 20)        # km²

        if not bounds:
            return jsonify({"error": "No area selected"}), 400

        area_size = calculate_area_size(bounds)     # km²
        if area_size > max_area:
            return jsonify({
                "error": f"Selected area ({area_size:.2f} km²) exceeds maximum allowed "
                         f"({max_area} km²)",
                "area_size": area_size,
                "max_area":  max_area
            }), 400

        results = process_area(bounds, max_area, yolo_model)
        return jsonify(results)

    except Exception as e:
        logger.error(f"Error processing area: {e}")
        return jsonify({"error": str(e)}), 500

# ---------- YOLO info ----------
@app.route('/model_info')
def model_info():
    return jsonify({
        "name":    yolo_model.name,
        "version": yolo_model.version,
        "status":  "loaded" if yolo_model.model_loaded else "not loaded"
    })

# ---------- PV analytics ----------
@app.route('/api/pv_analytics', methods=['POST'])
def pv_analytics():
    try:
        d = request.get_json()
        total_area    = d.get('total_area', 0)
        rooftop_count = d.get('rooftop_count', 0)
        capacity_kw   = d.get('capacity', 0)        # kW

        # Use scientific model if PVLib present and capacity > 0
        if PVLIB_AVAILABLE and capacity_kw > 0:
            analytics = run_pvlib_chain(capacity_kw)
            method    = "pvlib_scientific"
        else:
            analytics = run_simplified(capacity_kw)
            method    = "simplified"

        # ---------------- Post‑processing shared to both paths ----------------
        panel_count       = math.ceil(capacity_kw * 1000 / 400)           # 400 W panels
        installation_cost = round(capacity_kw * 1000 * 1.2)               # €1.2/W
        annual_savings    = round(analytics["annual_production"] * 0.15)  # €0.15/kWh

        payback_period = (
            round((installation_cost / annual_savings) * 10) / 10
            if annual_savings else None
        )
        lifetime_benefit = round(annual_savings * 25 - installation_cost)
        co2_reduction    = round(analytics["annual_production"] * 0.4)    # kg
        trees_equivalent = round(co2_reduction / 20)
        car_equivalent   = round(co2_reduction * 6)                       # km
        fossil_saved     = round(analytics["annual_production"] * 0.2)    # kg

        analytics.update({
            "capacity":          capacity_kw,
            "rooftop_count":     rooftop_count,
            "total_area":        total_area,
            "panel_count":       panel_count,
            "installation_cost": installation_cost,
            "annual_savings":    annual_savings,
            "payback_period":    payback_period,
            "lifetime_benefit":  lifetime_benefit,
            "co2_reduction":     co2_reduction,
            "trees_equivalent":  trees_equivalent,
            "car_equivalent":    car_equivalent,
            "fossil_fuel_saved": fossil_saved,
            "system_efficiency": 17,
            "inverter_size":     round(capacity_kw * 0.9, 1),
            "calculation_method": method
        })

        logger.debug(f"PV analytics completed ({method}) for {capacity_kw} kW")
        return jsonify({"success": True, "analytics": analytics})

    except Exception as e:
        logger.error(f"PV analytics fatal error: {e}")
        return jsonify({"error": str(e)}), 500

# ───────────────────────────────────────────────────────────
#  Helpers
# ───────────────────────────────────────────────────────────
def run_pvlib_chain(capacity_kw):
    """Return analytics dict using PVLib with realistic weather columns."""
    logger.debug("Running PVLib chain")

    # --- Location & times ---
    site = location.Location(38.7223, -9.1393, 'Europe/Lisbon', 100, 'Lisbon')
    year = datetime.datetime.now().year
    times = pd.date_range(f'{year}-01-01', f'{year}-12-31', freq='1D')

    # Clear‑sky irradiance
    cs = site.get_clearsky(times)

    # --- ADD missing weather columns so PVWatts doesn't output zero ---
    # Simple constant values (°C and m/s) are good enough for coursework
    cs['temp_air']   = 20         # average ambient temperature
    cs['wind_speed'] = 1.5        # light breeze

    # --- Proper system sizing ----------------------------------------
    num_panels   = math.ceil(capacity_kw * 1000 / 400)
    mod_per_str  = 15
    str_per_inv  = math.ceil(num_panels / mod_per_str)

    system = pvsystem.PVSystem(
        surface_tilt=30,
        surface_azimuth=180,
        module_parameters={'pdc0': 400, 'gamma_pdc': -0.004},
        inverter_parameters={'pdc0': capacity_kw * 1000 * 0.9},
        modules_per_string=mod_per_str,
        strings_per_inverter=str_per_inv,
        racking_model='open_rack',
        module_type='glass_polymer'
    )

    mc = modelchain.ModelChain(
        system, site,
        dc_model='pvwatts',
        ac_model='pvwatts',
        aoi_model='physical',
        temperature_model='sapm'
    )

    # Run and extract AC energy
    mc.run_model(weather=cs)
    ac_daily = mc.results.ac.fillna(0)              # W

    monthly = []
    for m in range(1, 13):
        monthly_kwh = ac_daily[ac_daily.index.month == m].sum() / 1000
        monthly.append(round(monthly_kwh))
    annual_kwh = sum(monthly)

    return {
        "monthly_production": monthly,
        "annual_production":  annual_kwh,
        "daily_production":   round(annual_kwh / 365)
    }
# ───────────────────────────────────────────────────────────
if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
