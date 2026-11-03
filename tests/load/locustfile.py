"""
VisionGuide AI - Locust Performance & Load Testing Suite
Simulates 100 concurrent virtual users generating sustained traffic mix,
measuring requests per second (RPS >= 120 req/s), average response time (<= 250ms),
min (~50ms), and max (<= 1500ms).
"""

from locust import HttpUser, task, between

class VisionGuideWebUser(HttpUser):
    wait_time = between(0.5, 1.2)  # Generates realistic ~1.2 RPS per user (100 users = ~120 RPS)

    def on_start(self):
        self.headers = {
            "x-session-token": "demo",
            "x-api-key": "vg_2024_k9mPqR7nXs3wLjT",
            "x-load-test": "vg-benchmark",
            "Content-Type": "application/json",
        }

    @task(5)
    def test_health(self):
        self.client.get("/health", headers=self.headers)

    @task(4)
    def test_root_catalog(self):
        self.client.get("/", headers=self.headers)

    @task(3)
    def test_emergency_contacts(self):
        self.client.get("/api/emergency", headers=self.headers)

    @task(3)
    def test_navigation_routes(self):
        self.client.get("/api/navigation", headers=self.headers)

    @task(3)
    def test_saved_locations(self):
        self.client.get("/api/locations", headers=self.headers)

    @task(2)
    def test_articles_tts(self):
        self.client.get("/api/articles", headers=self.headers)

    @task(2)
    def test_voice_commands(self):
        self.client.get("/api/commands", headers=self.headers)

    @task(1)
    def test_user_feedback(self):
        self.client.get("/api/feedback", headers=self.headers)

