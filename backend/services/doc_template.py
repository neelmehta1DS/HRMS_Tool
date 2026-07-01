from datetime import datetime
from typing import Optional


_TITLE_COLOR   = {"red": 0.118, "green": 0.239, "blue": 0.376}  # dark navy
_SECTION_COLOR = {"red": 0.180, "green": 0.459, "blue": 0.714}  # blue
_SUBHEAD_COLOR = {"red": 0.502, "green": 0.502, "blue": 0.502}  # gray


def build_doc_requests(
    employee_name: str,
    manager_name: str,
    meeting_link: str,
    catchup_date: datetime,
) -> list[dict]:
    """Returns batchUpdate requests that populate a blank Google Doc with the catchup template."""
    month_year = catchup_date.strftime("%B %Y")

    # Each block represents one paragraph line.
    # Keys: t (text), bullet, bold, color, pt (font size), bold_prefix (chars to bold at line start only)
    blocks = [
        {"t": f"Monthly Sync: {employee_name} & {manager_name}", "bold": True, "color": _TITLE_COLOR, "pt": 22},
        {"t": ""},
        {"t": f"Event: {meeting_link}", "bold_prefix": 7},
        {"t": f"Month: {month_year}", "bold_prefix": 7},
        {"t": ""},
        {"t": "1. Wins and Goals", "color": _SECTION_COLOR, "pt": 16},
        {"t": ""},
        {"t": "Shipped Last Month", "color": _SUBHEAD_COLOR},
        {"t": "[Win or shipped item]", "bullet": True},
        {"t": "[Win or shipped item]", "bullet": True},
        {"t": ""},
        {"t": "Building & Shipping This Month", "color": _SUBHEAD_COLOR},
        {"t": "[Item] (Target Date: MM/DD)", "bullet": True},
        {"t": "[Item] (Target Date: MM/DD)", "bullet": True},
        {"t": ""},
        {"t": "2. Blockers, Priorities & Cross-Functional Dependencies", "color": _SECTION_COLOR, "pt": 16},
        {"t": ""},
        {"t": "Strategic Priorities", "color": _SUBHEAD_COLOR},
        {"t": "[The 1-2 things that absolutely must succeed this month]", "bullet": True},
        {"t": ""},
        {"t": "Cross-Functional Dependencies & Blockers", "color": _SUBHEAD_COLOR},
        {"t": "[e.g., Need engineering clarity on X]", "bullet": True},
        {"t": ""},
        {"t": "3. Feedback & Professional Growth", "color": _SECTION_COLOR, "pt": 16},
        {"t": ""},
        {"t": "Manager Feedback", "color": _SUBHEAD_COLOR},
        {"t": "[Notes on performance, wins, or calibration]", "bullet": True},
        {"t": ""},
        {"t": "Skills to Develop", "color": _SUBHEAD_COLOR},
        {"t": "[Specific focus areas this month, e.g., technical scoping, scoping MVPs, stakeholder management]", "bullet": True},
        {"t": ""},
        {"t": "4. Action Items & Decisions", "color": _SECTION_COLOR, "pt": 16},
        {"t": ""},
        {"t": "Action Items", "color": _SUBHEAD_COLOR},
        {"t": "[Action] [Owner] - Task details", "bullet": True},
        {"t": "[Action] [Owner] - Task details", "bullet": True},
        {"t": ""},
        {"t": "Key Decisions Made", "color": _SUBHEAD_COLOR},
        {"t": "[Any pivot, scope change, or timeline shift agreed on today]", "bullet": True},
    ]

    # Build the full text string and record each paragraph's [start, end) index.
    # Google Docs body starts at index 1.
    full_text = ""
    ranges: list[tuple[int, int, dict]] = []
    idx = 1
    for block in blocks:
        line = block["t"] + "\n"
        ranges.append((idx, idx + len(line), block))
        full_text += line
        idx += len(line)

    requests: list[dict] = []

    # 1. Insert all text in one shot.
    requests.append({
        "insertText": {
            "location": {"index": 1},
            "text": full_text,
        }
    })

    # 2. Apply text styles (color, bold, font size) per paragraph.
    for start, end, block in ranges:
        style: dict = {}
        fields: list[str] = []

        if block.get("bold"):
            style["bold"] = True
            fields.append("bold")
        if block.get("color"):
            style["foregroundColor"] = {"color": {"rgbColor": block["color"]}}
            fields.append("foregroundColor")
        if block.get("pt"):
            style["fontSize"] = {"magnitude": block["pt"], "unit": "PT"}
            fields.append("fontSize")

        if style:
            requests.append({
                "updateTextStyle": {
                    "range": {"startIndex": start, "endIndex": end},
                    "textStyle": style,
                    "fields": ",".join(fields),
                }
            })

        # Bold only the label prefix (e.g. "Event: ", "Month: ")
        if block.get("bold_prefix"):
            requests.append({
                "updateTextStyle": {
                    "range": {"startIndex": start, "endIndex": start + block["bold_prefix"]},
                    "textStyle": {"bold": True},
                    "fields": "bold",
                }
            })

    # 3. Apply bullet formatting to consecutive bullet paragraphs.
    i = 0
    while i < len(ranges):
        start, _, block = ranges[i]
        if block.get("bullet"):
            j = i + 1
            while j < len(ranges) and ranges[j][2].get("bullet"):
                j += 1
            _, end, _ = ranges[j - 1]
            requests.append({
                "createParagraphBullets": {
                    "range": {"startIndex": start, "endIndex": end},
                    "bulletPreset": "BULLET_DISC_CIRCLE_SQUARE",
                }
            })
            i = j
        else:
            i += 1

    return requests
