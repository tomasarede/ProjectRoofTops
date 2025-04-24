import os
from dotenv import load_dotenv
import json
import requests

from flask import Flask, render_template, request, jsonify, Response, send_file

import cv2
import numpy as np
import geopandas as gpd
from ultralytics import YOLO

from pvlib.pvsystem import PVSystem
from pvlib.location import Location
from pvlib import temperature
from pvlib.temperature import sapm_cell, TEMPERATURE_MODEL_PARAMETERS
import pandas as pd
import time

# Load environment variables from .env
load_dotenv()

# ––––– CONFIGURATION –––––
GOOGLE_STATIC_MAPS_URL = "https://maps.googleapis.com/maps/api/staticmap"
API_KEY = os.getenv("GOOGLE_MAPS_API_KEY")
MODEL_PATH = "/Users/joaosantos/Documents/MEFT/P3/SE/Project3/ProjectRoofTops/models/best_rooftop_model.pt"

# Ensure output directories exist
os.makedirs("static/prints", exist_ok=True)
os.makedirs("static/results", exist_ok=True)

# Load YOLOv8 model
model = YOLO(MODEL_PATH)

# Initialize Flask app
app = Flask(__name__)


@app.route("/")
def index():
    return render_template("index.html", api_key=API_KEY)



@app.route("/capture", methods=["POST"])
def capture():
    import sys
    print("Python path:", sys.executable)

    """
    Given center coordinates and zoom, fetch a Static Maps image,
    run YOLOv8 inference (conf >= 0.5), draw aesthetic boxes and labels,
    and return the annotated PNG.
    """
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
    }

    try:
        # Fetch static map
        resp = requests.get(GOOGLE_STATIC_MAPS_URL, params=params)
        resp.raise_for_status()
        img_bytes = resp.content

        # Optionally save the raw snapshot
        raw_path = "static/prints/print.png"
        with open(raw_path, "wb") as f:
            f.write(img_bytes)

        # Decode to OpenCV image
        image = cv2.imdecode(
            np.frombuffer(img_bytes, dtype=np.uint8), cv2.IMREAD_COLOR
        )

        # YOLO inference
        results = model.predict(source=image, conf=0.3)[0]
        accent = (77, 157, 224)  

        rooftop_data = []
        for i, box in enumerate(results.boxes):
            x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
            conf = float(box.conf[0])
            if conf < 0.3:
                continue

            # semi-transparent fill
            overlay = image.copy()
            cv2.rectangle(overlay, (x1, y1), (x2, y2), accent, thickness=-1)
            image = cv2.addWeighted(overlay, 0.3, image, 0.7, 0)

            # anti-aliased border
            cv2.rectangle(
                image, (x1, y1), (x2, y2), accent, thickness=3, lineType=cv2.LINE_AA
            )

            # solid background for label
            label = f"{conf:.2f}"
            (tw, th), baseline = cv2.getTextSize(
                label, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2
            )
            rect_tl = (x1, y1 - th - baseline - 4)
            rect_br = (x1 + tw + 6, y1)
            cv2.rectangle(image, rect_tl, rect_br, accent, thickness=-1)

            # anti-aliased white text
            text_org = (x1 + 3, y1 - baseline - 2)
            cv2.putText(
                image,
                label,
                text_org,
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                (255, 255, 255),
                2,
                lineType=cv2.LINE_AA,
            )

            # Draw rooftop number label (e.g., Rooftop #1)
            label_text = f"#{i + 1}"
            cv2.putText(
                image,
                label_text,
                (x1 + 5, y1 + 25),  # position slightly inside the box
                cv2.FONT_HERSHEY_SIMPLEX,
                0.9,
                (255, 255, 255),  # white text
                2,
                lineType=cv2.LINE_AA
            )

            # Approximate rooftop area in m² (based on zoom level)
            if zoom == 19:
                meters_per_pixel = 0.149
            elif zoom >= 20:
                meters_per_pixel = 0.075
            width = (x2 - x1) * meters_per_pixel
            height = (y2 - y1) * meters_per_pixel
            area_m2 = width * height

            panel_area_m2 = 1.8
            num_modules = int(area_m2 / panel_area_m2)

           # PVLIB simulation (basic setup)

            site = Location(latitude=lat, longitude=lng)

            system = PVSystem(
                surface_tilt=30, surface_azimuth=180,
                module_parameters={'pdc0': 300, 'gamma_pdc': -0.003},
                inverter_parameters={'pdc0': 290}
            )

            times = pd.date_range("2024-06-01", periods=8760, freq="h", tz="UTC")
            weather = site.get_clearsky(times)
            # Choose the correct mounting type
            params = TEMPERATURE_MODEL_PARAMETERS['sapm']['open_rack_glass_glass']

            # Compute module cell temperatures using the Sandia model
            temps = sapm_cell(
                poa_global=weather['ghi'],
                temp_air=25,
                wind_speed=1,
                **params
            )

            # Use the cell temps in your DC → AC power calculation
            dc = system.pvwatts_dc(weather['ghi'], temps)
            ac = np.minimum(dc, system.inverter_parameters['pdc0'])
            kwh_per_module = float(ac.sum()) / 1000
            kwh_total = round(kwh_per_module * num_modules, 2)

            rooftop_data.append({
                "box": [x1, y1, x2, y2],
                "confidence": round(conf, 2),
                "area_m2": round(area_m2, 2),
                "modules": num_modules,
                "kwh_per_year": kwh_total
            })



        annotated_path = "static/results/annotated.png"
        cv2.imwrite(annotated_path, image)
        return jsonify({
            "image_path": f"/static/results/annotated.png?ts={int(time.time())}",
            "rooftop_data": rooftop_data
        })



    except Exception as e:
        print("Error in /capture:", str(e))
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)