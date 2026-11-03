"""
VisionGuide AI - Selenium Page Object Model: Auth Page
"""

from .base_page import BasePage

class AuthPage(BasePage):
    def open_signin(self):
        return self.open("/signin")

    def open_signup(self):
        return self.open("/signup")
