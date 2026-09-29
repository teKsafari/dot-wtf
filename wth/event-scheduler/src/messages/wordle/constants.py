import os
from dotenv import load_dotenv
import json

load_dotenv()

NOTIFICATIONS_SENDER_EMAIL = os.getenv("NOTIFICATIONS_SENDER_EMAIL")
GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.compose", "https://www.googleapis.com/auth/gmail.settings.basic"]
GMAIL_API_SECRETS = json.loads(os.getenv("GMAIL_API_SECRETS"))
NOTIFICATIONS_SENDER_EMAIL= os.getenv("NOTIFICATIONS_SENDER_EMAIL")
GMAIL_DISPLAY_NAME = "dot WTF"