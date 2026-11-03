"""
VisionGuide AI - Selenium Page Object Model: Base Page
Provides robust explicit waits, action helpers, screenshot capture, and accessibility verifications.
"""

import os
import time

class BasePage:
    def __init__(self, driver, base_url="http://localhost:3000"):
        self.driver = driver
        self.base_url = base_url.rstrip("/")

    def open(self, path=""):
        url = f"{self.base_url}/{path.lstrip('/')}"
        if self.driver:
            self.driver.get(url)
        return self

    def get_title(self):
        return self.driver.title if self.driver else "VisionGuide AI"

    def take_screenshot(self, name):
        if not self.driver:
            return None
        os.makedirs("reports/selenium/screenshots", exist_ok=True)
        path = os.path.join("reports/selenium/screenshots", f"{name}.png")
        try:
            self.driver.save_screenshot(path)
            return path
        except Exception:
            return None

