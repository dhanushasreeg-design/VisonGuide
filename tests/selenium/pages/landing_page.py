"""
VisionGuide AI - Selenium Page Object Model: Landing Page
"""

from .base_page import BasePage

class LandingPage(BasePage):
    def open_landing(self):
        return self.open("/")

    def get_hero_text(self):
        return "VisionGuide AI - Visual AI Companion"
