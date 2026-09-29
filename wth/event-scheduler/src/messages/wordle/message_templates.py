from enum import StrEnum


class MessageGreetings(StrEnum):
    ITS_BEEN_A_WHILE = "Hi there {user_name}!"

class MessageBodies(StrEnum):
    ITS_BEEN_A_WHILE = """
    It's been a while since you last played CWRU Wordle. Come back to play and make your way to the top of the leaderboard!
    """

class MessageSubjects(StrEnum):
    ITS_BEEN_A_WHILE = "Where*TF have you been? 😔"