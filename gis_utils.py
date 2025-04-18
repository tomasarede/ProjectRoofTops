import logging
import numpy as np  # Keep numpy for array handling
import uuid
import requests
import geopandas as gpd
import shapely.geometry as sg
from shapely.ops import transform
from shapely.geometry import Polygon, Point
import pyproj
from functools import partial
from io import BytesIO
from typing import Dict, List, Any, Tuple
from PIL import Image
from models import Rooftop, AnalysisResult

logger = logging.getLogger(__name__)

def get_portugal_bounds() -> Dict[str, float]:
    """
    Returns the geographic bounds of Portugal
    """
    return {
        "north": 42.15,  # Northern most point
        "south": 36.95,  # Southern most point
        "west": -9.5,    # Western most point
        "east": -6.18    # Eastern most point
    }

def process_area(bounds: Dict[str, float], max_area: float, yolo_model) -> Dict[str, Any]:
    """
    Process the selected area to identify empty rooftops
    
    Args:
        bounds: Dictionary with north, south, east, west bounds
        max_area: Maximum area constraint in square meters
        yolo_model: Initialized YOLO model for detection
        
    Returns:
        Dictionary with analysis results
    """
    logger.debug(f"Processing area with bounds: {bounds}")
    
    # Validate area size
    area_size = calculate_area_size(bounds)
    logger.debug(f"Area size: {area_size} km²")
    
    if area_size > max_area:
        logger.warning(f"Selected area ({area_size} km²) exceeds maximum allowed area ({max_area} km²)")
        return {
            "error": f"Selected area ({area_size:.2f} km²) exceeds maximum allowed area ({max_area} km²)",
            "area_size": area_size,
            "max_area": max_area
        }
    
    # Split area into manageable chunks if needed
    chunks = split_area_into_chunks(bounds)
    logger.debug(f"Split area into {len(chunks)} chunks")
    
    all_rooftops = []
    
    # Process each chunk
    for chunk_bounds in chunks:
        # In a real implementation, fetch satellite/aerial imagery for this chunk
        # image_data = fetch_imagery(chunk_bounds)
        
        # For demonstration, generate a mock image
        image_data = generate_mock_image(chunk_bounds)
        
        # Calculate geo transform for this chunk
        geo_transform = calculate_geo_transform(chunk_bounds, image_data.shape[1], image_data.shape[0])
        
        # Detect rooftops in this chunk
        chunk_rooftops = yolo_model.detect_rooftops(image_data, geo_transform, chunk_bounds)
        all_rooftops.extend(chunk_rooftops)
    
    # Calculate total area and other statistics
    total_area = sum(r.area for r in all_rooftops)
    
    # Create and return the final result
    result = AnalysisResult(
        rooftops=all_rooftops,
        total_area=total_area,
        count=len(all_rooftops),
        bounds=bounds,
        max_area_constraint=max_area
    )
    
    return result.to_dict()

def calculate_area_size(bounds: Dict[str, float]) -> float:
    """
    Calculate the approximate size of the area in square kilometers using GeoPandas
    
    Args:
        bounds: Dictionary with north, south, east, west bounds
        
    Returns:
        Area size in square kilometers
    """
    # Create a polygon from the bounds
    polygon = Polygon([
        (bounds['west'], bounds['south']),
        (bounds['east'], bounds['south']),
        (bounds['east'], bounds['north']),
        (bounds['west'], bounds['north']),
        (bounds['west'], bounds['south'])
    ])
    
    # Create a GeoPandas GeoDataFrame with WGS84 CRS
    gdf = gpd.GeoDataFrame({'geometry': [polygon]}, crs='EPSG:4326')
    
    # Project to an equal-area projection (EPSG:3857 - Web Mercator)
    gdf_projected = gdf.to_crs('EPSG:3857')
    
    # Calculate area in square meters and convert to square kilometers
    area_km2 = gdf_projected.area.values[0] / 1_000_000
    
    return area_km2

def split_area_into_chunks(bounds: Dict[str, float], max_chunk_size: float = 1.0) -> List[Dict[str, float]]:
    """
    Split a large area into smaller, manageable chunks
    
    Args:
        bounds: Dictionary with north, south, east, west bounds
        max_chunk_size: Maximum chunk size in square kilometers
        
    Returns:
        List of dictionaries, each with bounds for a chunk
    """
    area_size = calculate_area_size(bounds)
    
    if area_size <= max_chunk_size:
        return [bounds]
    
    # Calculate how many divisions we need
    num_divisions = int(np.ceil(np.sqrt(area_size / max_chunk_size)))
    
    # Calculate step sizes
    lat_step = (bounds['north'] - bounds['south']) / num_divisions
    lng_step = (bounds['east'] - bounds['west']) / num_divisions
    
    chunks = []
    
    for i in range(num_divisions):
        south = bounds['south'] + i * lat_step
        north = south + lat_step
        
        for j in range(num_divisions):
            west = bounds['west'] + j * lng_step
            east = west + lng_step
            
            chunk_bounds = {
                'north': north,
                'south': south,
                'east': east,
                'west': west
            }
            
            chunks.append(chunk_bounds)
    
    return chunks

def generate_mock_image(bounds: Dict[str, float]) -> np.ndarray:
    """
    Generate a mock image for the given bounds
    
    In a real implementation, this would fetch actual satellite/aerial imagery
    
    Args:
        bounds: Dictionary with north, south, east, west bounds
        
    Returns:
        NumPy array representing an image
    """
    # Create a blank image (512x512 pixels)
    image = np.zeros((512, 512, 3), dtype=np.uint8)
    
    # Add some random patterns to simulate satellite imagery
    for _ in range(50):
        x1, y1 = np.random.randint(0, 512, 2)
        w, h = np.random.randint(20, 100, 2)
        x2, y2 = x1 + w, y1 + h
        
        # Keep within image bounds
        x2 = min(x2, 511)
        y2 = min(y2, 511)
        
        # Generate a random building-like color
        color = np.random.randint(100, 200, 3)
        
        # Draw a rectangle
        image[y1:y2, x1:x2] = color
    
    # Add some texture
    noise = np.random.randint(0, 30, (512, 512, 3), dtype=np.uint8)
    image = np.clip(image.astype(np.int32) + noise, 0, 255).astype(np.uint8)
    
    return image

def calculate_geo_transform(bounds: Dict[str, float], width: int, height: int) -> List[float]:
    """
    Calculate the transformation between pixel and geographic coordinates
    
    Args:
        bounds: Dictionary with north, south, east, west bounds
        width: Image width in pixels
        height: Image height in pixels
        
    Returns:
        List of transformation parameters
    """
    # Calculate pixel sizes
    x_res = (bounds['east'] - bounds['west']) / width
    y_res = (bounds['north'] - bounds['south']) / height
    
    # Create transformation: [top_left_x, w-e_pixel_size, 0, top_left_y, 0, n-s_pixel_size]
    return [bounds['west'], x_res, 0, bounds['north'], 0, -y_res]
