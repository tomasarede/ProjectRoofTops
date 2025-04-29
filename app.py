"""
Energy Services Course - IST - April 2025

Diogo Franco ist1103276
João Santos ist1103243
Tomás Arêde ist1103239
"""

import os
from dotenv import load_dotenv
import json
import requests

from flask import Flask, render_template, request, jsonify, send_file

import cv2
import numpy as np
from ultralytics import YOLO

from pvlib.pvsystem import PVSystem
from pvlib.location import Location
from pvlib.temperature import sapm_cell, TEMPERATURE_MODEL_PARAMETERS
import pandas as pd
import time

# Load environment variables
load_dotenv()

# Constants
PV_PANEL_COST_PER_KW = 1500
PV_PANEL_EFFICIENCY = 0.19
ELECTRICITY_COST_PER_KWH = 0.24
CO2_PER_KWH = 0.08
PANEL_POWER_RATING_W = 400
API_KEY = os.getenv("GOOGLE_MAPS_API_KEY")
MODEL_PATH = "models/best_rooftop_model.pt"
GOOGLE_STATIC_MAPS_URL = "https://maps.googleapis.com/maps/api/staticmap"

# Load model
model = YOLO(MODEL_PATH)

# Flask app
app = Flask(__name__)

@app.route("/")
def index():
    return render_template("index.html", api_key=API_KEY)

@app.route("/temp/<filename>")
def serve_temp_file(filename):
    path = os.path.join("/tmp", filename)
    return send_file(path)

@app.route("/capture", methods=["POST"])
def capture():
    data = request.get_json()
    lat = data.get("lat")
    lng = data.get("lng")
    zoom = data.get("zoom")
    size = data.get("size", "600x400")

    if zoom < 19:
        return jsonify({"error": "Minimum zoom for capture is 19"}), 400

    params = {
        "center": f"{lat},{lng}",
        "zoom": zoom,
        "size": size,
        "maptype": "hybrid",
        "key": API_KEY,
        "style": "feature:all|element:labels|visibility:off"
    }

    try:
        resp = requests.get(GOOGLE_STATIC_MAPS_URL, params=params)
        resp.raise_for_status()
        img_bytes = resp.content

        # Save raw image to /tmp
        raw_path = "/tmp/print.png"
        with open(raw_path, "wb") as f:
            f.write(img_bytes)

        image = cv2.imdecode(np.frombuffer(img_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)

        results = model.predict(source=image, conf=0.4)[0]
        accent = (77, 157, 224)

        rooftop_data = []

        for i, box in enumerate(results.boxes):
            x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
            conf = float(box.conf[0])

            overlay = image.copy()
            cv2.rectangle(overlay, (x1, y1), (x2, y2), accent, -1)
            image = cv2.addWeighted(overlay, 0.3, image, 0.7, 0)
            cv2.rectangle(image, (x1, y1), (x2, y2), accent, 3, lineType=cv2.LINE_AA)

            label = f"{conf:.2f}"
            (tw, th), baseline = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)
            rect_tl = (x1, y1 - th - baseline - 4)
            rect_br = (x1 + tw + 6, y1)
            cv2.rectangle(image, rect_tl, rect_br, accent, -1)
            text_org = (x1 + 3, y1 - baseline - 2)
            cv2.putText(image, label, text_org, cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255,255,255), 2, cv2.LINE_AA)
            cv2.putText(image, f"#{i+1}", (x1+5, y1+25), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255,255,255), 2, cv2.LINE_AA)

            meters_per_pixel = 156543.03392 * np.cos(np.radians(lat)) / (2 ** zoom)
            width = (x2 - x1) * meters_per_pixel
            height = (y2 - y1) * meters_per_pixel
            area_m2 = width * height

            panel_area_m2 = 1.8
            num_modules = int((area_m2 / panel_area_m2) * 0.2)

            site = Location(latitude=lat, longitude=lng)
            system = PVSystem(
                surface_tilt=30, surface_azimuth=180,
                module_parameters={'pdc0': PANEL_POWER_RATING_W, 'gamma_pdc': -0.003},
                inverter_parameters={'pdc0': PANEL_POWER_RATING_W * 0.97}
            )

            timezone = site.tz
            times = pd.date_range("2024-01-01", periods=8760, freq="h", tz=timezone)
            weather = site.get_clearsky(times)
            params = TEMPERATURE_MODEL_PARAMETERS['sapm']['open_rack_glass_glass']

            temps = sapm_cell(poa_global=weather['ghi'], temp_air=25, wind_speed=1, **params)
            dc = system.pvwatts_dc(weather['ghi'], temps)
            ac = np.minimum(dc, system.inverter_parameters['pdc0'])
            kwh_per_module = float(ac.sum()) / 1000
            kwh_total = round(kwh_per_module * num_modules, 2)

            ac_series = pd.Series(ac, index=times)
            monthly_ac = ac_series.resample('ME').sum()
            monthly_kwh = [round(val / 1000 * num_modules, 2) for val in monthly_ac]

            annual_co2_savings_kg = kwh_total * CO2_PER_KWH
            total_capacity_kw = (PANEL_POWER_RATING_W * num_modules) / 1000
            installation_cost = total_capacity_kw * PV_PANEL_COST_PER_KW
            annual_financial_savings = kwh_total * ELECTRICITY_COST_PER_KWH

            rooftop_data.append({
                "box": [x1, y1, x2, y2],
                "confidence": round(conf, 2),
                "area_m2": round(area_m2, 2),
                "modules": num_modules,
                "kwh_per_year": kwh_total,
                "monthly_kwh": monthly_kwh,
                "co2_savings_kg": round(annual_co2_savings_kg, 2),
                "installation_cost": round(installation_cost, 2),
                "annual_savings": round(annual_financial_savings, 2),
                "capacity_kw": round(total_capacity_kw, 2)
            })

        # Save annotated image
        annotated_path = "/tmp/annotated.png"
        cv2.imwrite(annotated_path, image)

        return jsonify({
            "image_path": f"/temp/annotated.png?ts={int(time.time())}",
            "rooftop_data": rooftop_data
        })

    except Exception as e:
        print("Error in /capture:", str(e))
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run()
