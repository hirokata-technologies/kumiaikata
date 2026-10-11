"""Entry point ADK loads: `root_agent` is the agent users talk to."""

from .project_manager import build_project_manager
from .settings import load_model_settings

root_agent = build_project_manager(load_model_settings())
