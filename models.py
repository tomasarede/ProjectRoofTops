import os
import json
import datetime
import numpy as np
from dataclasses import dataclass
from typing import List, Dict, Any, Tuple
from sqlalchemy import Column, Integer, Float, String, DateTime, Text, ForeignKey
from sqlalchemy.orm import relationship

from extensions import db, logger

@dataclass
class Rooftop:
    """Class for representing a detected empty rooftop"""
    id: str
    coordinates: List[Tuple[float, float]]  # GeoJSON polygon coordinates
    area: float  # Area in square meters
    confidence: float  # Detection confidence
    centroid: Tuple[float, float]  # Center point (lat, lng)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert the rooftop to a dictionary for JSON serialization"""
        return {
            "id": self.id,
            "coordinates": self.coordinates,
            "area": self.area,
            "confidence": self.confidence,
            "centroid": self.centroid
        }

@dataclass
class AnalysisResult:
    """Class for representing the analysis results for an area"""
    rooftops: List[Rooftop]
    total_area: float
    count: int
    bounds: Dict[str, float]
    max_area_constraint: float
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert the result to a dictionary for JSON serialization"""
        return {
            "rooftops": [r.to_dict() for r in self.rooftops],
            "total_area": self.total_area,
            "count": self.count,
            "bounds": self.bounds,
            "max_area_constraint": self.max_area_constraint,
            "statistics": self.get_statistics()
        }
    
    def get_statistics(self) -> Dict[str, Any]:
        """Calculate additional statistics about the rooftops"""
        if not self.rooftops:
            return {
                "min_area": 0,
                "max_area": 0,
                "avg_area": 0,
                "potential_capacity": 0,
                "area_distribution": []
            }
        
        areas = [r.area for r in self.rooftops]
        
        # Calculate potential PV capacity (rough estimate: 1 m² ≈ 150W)
        potential_capacity = sum(areas) * 0.15  # kW
        
        # Create area distribution in buckets
        buckets = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50]
        distribution = [0] * (len(buckets) - 1)
        
        for area in areas:
            for i in range(len(buckets) - 1):
                if buckets[i] <= area < buckets[i+1]:
                    distribution[i] += 1
                    break
            if area >= buckets[-1]:
                distribution[-1] += 1
        
        # Format distribution for the frontend
        area_distribution = []
        for i in range(len(buckets) - 1):
            if i == len(buckets) - 2:
                label = f">{buckets[i]} m²"
            else:
                label = f"{buckets[i]}-{buckets[i+1]} m²"
            area_distribution.append({
                "range": label,
                "count": distribution[i]
            })
        
        return {
            "min_area": min(areas) if areas else 0,
            "max_area": max(areas) if areas else 0,
            "avg_area": sum(areas) / len(areas) if areas else 0,
            "potential_capacity": potential_capacity,
            "area_distribution": area_distribution
        }

# Database models for storing analysis results
class AnalysisSession(db.Model):
    """Model for storing a session of area analysis"""
    __tablename__ = 'analysis_sessions'
    
    id = Column(Integer, primary_key=True)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow)
    bounds_north = Column(Float, nullable=False)
    bounds_south = Column(Float, nullable=False)
    bounds_east = Column(Float, nullable=False)
    bounds_west = Column(Float, nullable=False)
    area_size_km2 = Column(Float, nullable=False)
    max_area_constraint = Column(Float, nullable=False)
    rooftop_count = Column(Integer, nullable=False)
    total_rooftop_area = Column(Float, nullable=False)
    potential_capacity_kw = Column(Float, nullable=False)
    
    # Relationships
    rooftops = relationship('DetectedRooftop', back_populates='session', cascade='all, delete-orphan')
    
    def to_dict(self):
        return {
            'id': self.id,
            'timestamp': self.timestamp.isoformat(),
            'bounds': {
                'north': self.bounds_north,
                'south': self.bounds_south,
                'east': self.bounds_east,
                'west': self.bounds_west
            },
            'area_size_km2': self.area_size_km2,
            'max_area_constraint': self.max_area_constraint,
            'rooftop_count': self.rooftop_count,
            'total_rooftop_area': self.total_rooftop_area,
            'potential_capacity_kw': self.potential_capacity_kw
        }
    
    @classmethod
    def from_analysis_result(cls, result: AnalysisResult):
        """Create an AnalysisSession from an AnalysisResult object"""
        stats = result.get_statistics()
        session = cls(
            bounds_north=result.bounds['north'],
            bounds_south=result.bounds['south'],
            bounds_east=result.bounds['east'],
            bounds_west=result.bounds['west'],
            area_size_km2=calculate_area_size(result.bounds),
            max_area_constraint=result.max_area_constraint,
            rooftop_count=result.count,
            total_rooftop_area=result.total_area,
            potential_capacity_kw=stats['potential_capacity']
        )
        return session

class DetectedRooftop(db.Model):
    """Model for storing detected rooftops"""
    __tablename__ = 'detected_rooftops'
    
    id = Column(Integer, primary_key=True)
    rooftop_uuid = Column(String(36), nullable=False)
    session_id = Column(Integer, ForeignKey('analysis_sessions.id'), nullable=False)
    coordinates_json = Column(Text, nullable=False)  # Stored as GeoJSON string
    area = Column(Float, nullable=False)
    confidence = Column(Float, nullable=False)
    centroid_lat = Column(Float, nullable=False)
    centroid_lng = Column(Float, nullable=False)
    
    # Relationships
    session = relationship('AnalysisSession', back_populates='rooftops')
    
    def to_dict(self):
        return {
            'id': self.id,
            'rooftop_uuid': self.rooftop_uuid,
            'coordinates': json.loads(self.coordinates_json),
            'area': self.area,
            'confidence': self.confidence,
            'centroid': [self.centroid_lat, self.centroid_lng]
        }
    
    @classmethod
    def from_rooftop(cls, rooftop: Rooftop, session_id: int):
        """Create a DetectedRooftop from a Rooftop object"""
        return cls(
            rooftop_uuid=rooftop.id,
            session_id=session_id,
            coordinates_json=json.dumps(rooftop.coordinates),
            area=rooftop.area,
            confidence=rooftop.confidence,
            centroid_lat=rooftop.centroid[0],
            centroid_lng=rooftop.centroid[1]
        )

def calculate_area_size(bounds: Dict[str, float]) -> float:
    """
    Calculate the approximate size of the area in square kilometers
    
    Args:
        bounds: Dictionary with north, south, east, west bounds
        
    Returns:
        Area size in square kilometers
    """
    import numpy as np
    
    # Calculate width and height in degrees
    width_deg = bounds['east'] - bounds['west']
    height_deg = bounds['north'] - bounds['south']
    
    # Average latitude for width calculation
    avg_lat = (bounds['north'] + bounds['south']) / 2
    
    # Convert degrees to kilometers (approximate)
    # 1 degree of latitude ≈ 111 km
    # 1 degree of longitude ≈ 111 km * cos(latitude)
    height_km = height_deg * 111
    width_km = width_deg * 111 * np.cos(np.radians(avg_lat))
    
    # Calculate area
    area_km2 = width_km * height_km
    
    return area_km2
