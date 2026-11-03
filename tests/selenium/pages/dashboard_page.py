"""
VisionGuide AI - Selenium Page Object Model: Dashboard Page
"""

from .base_page import BasePage

class DashboardPage(BasePage):
    def open_dashboard(self):
        return self.open("/dashboard")

    def open_voice(self):
        return self.open("/dashboard/voice")

    def open_navigation(self):
        return self.open("/dashboard/navigation")

    def open_camera(self):
        return self.open("/dashboard/camera")

    def open_sos(self):
        return self.open("/dashboard/sos")

    def open_contacts(self):
        return self.open("/dashboard/contacts")

    def open_locations(self):
        return self.open("/dashboard/locations")

