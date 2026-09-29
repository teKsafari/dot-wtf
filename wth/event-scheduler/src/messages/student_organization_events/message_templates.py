from enum import StrEnum


class EventMessages(StrEnum):
    REMINDER = """
        Hi there!,

        This is a gentle reminder that your upcoming event {event_name} hosted by {organization_name} is coming up soon! Check out the details below:

        Description: {event_description}
        Date: {event_date}
        Time: {event_time}
        Location: {event_location}

        We look forward to seeing you there!

        Message sent via dot*WTF Event Scheduler (visit us at https://cwru.wtf)
"""
