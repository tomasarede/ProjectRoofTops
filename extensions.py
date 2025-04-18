"""
Extensions module to avoid circular imports
"""
import os
import logging
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy.orm import DeclarativeBase

# Set up logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

# Initialize SQLAlchemy with base class
class Base(DeclarativeBase):
    pass

db = SQLAlchemy(model_class=Base)