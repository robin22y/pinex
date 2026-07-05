"""
Daily journal review reminders script.
Sends emails to users whose journal entries are due for review.
Runs as part of the GitHub Actions daily pipeline.
"""

from datetime import datetime, timedelta
import os
import time
import sys
from db import supabase
import resend

# Initialize Resend
resend.api_key = os.getenv('RESEND_API_KEY')

# Email templates by review_stage
EMAIL_TEMPLATES = {
    '7d': {
        'subject': 'Quick check — {ticker}',
        'body': 'You documented a decision on {ticker} 7 days ago. Has anything changed? Review your journal: https://pinex.in/journal'
    },
    '30d': {
        'subject': '{ticker} — one month in',
        'body': '30 days since your {ticker} decision. Time for a quick review. https://pinex.in/journal'
    },
    '90d': {
        'subject': '{ticker} — quarter review due',
        'body': '90 days in. This is the most important review. Did your thesis hold? https://pinex.in/journal'
    },
    '180d': {
        'subject': '{ticker} — six month check',
        'body': 'Six months since your {ticker} decision. How has your thinking evolved? https://pinex.in/journal'
    },
    '365d': {
        'subject': '{ticker} — one year on',
        'body': 'One year since you documented your {ticker} decision. Was your thesis right? https://pinex.in/journal'
    },
    'post_sell_90d': {
        'subject': 'Were you right about {ticker}?',
        'body': '90 days since you sold {ticker}. Now you can judge your decision. https://pinex.in/journal'
    }
}

# Next review intervals (in days)
NEXT_INTERVALS = {
    '7d': 23,           # reaches 30d
    '30d': 60,          # reaches 90d
    '90d': 90,          # reaches 180d
    '180d': 185,        # reaches 365d
    '365d': None,       # complete
    'post_sell_90d': None  # complete
}

# Next review stages
NEXT_STAGES = {
    '7d': '30d',
    '30d': '90d',
    '90d': '180d',
    '180d': '365d',
    '365d': 'complete',
    'post_sell_90d': 'complete'
}


def get_user_email(user_id):
    """Fetch user email from auth.users"""
    try:
        result = supabase.from_('profiles').select('email').eq('id', user_id).execute()
        if result.data:
            return result.data[0]['email']
    except Exception as e:
        print(f'Error fetching email for {user_id}: {e}')
    return None


def send_email(to_email, subject, body):
    """Send email via Resend"""
    try:
        resend.Emails.send({
            "from": "PineX <noreply@pinex.in>",
            "to": to_email,
            "subject": subject,
            "html": f"<p>{body}</p>"
        })
        return True
    except Exception as e:
        print(f'Error sending email to {to_email}: {e}')
        return False


def log_event(user_id, ticker, review_stage):
    """Log to usage_events table"""
    try:
        supabase.from_('usage_events').insert({
            'event_type': 'journal_reminder_sent',
            'user_id': user_id,
            'meta': {
                'ticker': ticker,
                'review_stage': review_stage
            }
        }).execute()
    except Exception as e:
        print(f'Error logging event: {e}')


def process_journal_reminder(entry):
    """Process a single journal entry"""
    entry_id = entry['id']
    user_id = entry['user_id']
    ticker = entry['ticker']
    review_stage = entry['review_stage']
    status = entry['status']
    sell_date = entry['sell_date']

    # Get user email
    user_email = get_user_email(user_id)
    if not user_email:
        print(f'Could not find email for user {user_id}')
        return False

    # Check if sold and override to post_sell_90d
    if status == 'sold' and review_stage not in ('post_sell_90d', 'complete'):
        if sell_date:
            sell_dt = datetime.strptime(sell_date, '%Y-%m-%d') if isinstance(sell_date, str) else sell_date
            next_due = (sell_dt + timedelta(days=90)).date()
            review_stage = 'post_sell_90d'
            # Update the entry before sending email
            supabase.from_('journal_meta').update({
                'review_stage': 'post_sell_90d',
                'next_review_due': str(next_due),
                'updated_at': datetime.utcnow().isoformat()
            }).eq('id', entry_id).execute()
            time.sleep(0.1)

    # Get email template
    template = EMAIL_TEMPLATES.get(review_stage)
    if not template:
        print(f'No email template for stage {review_stage}')
        return False

    # Format email
    subject = template['subject'].format(ticker=ticker)
    body = template['body'].format(ticker=ticker)

    # Send email
    if not send_email(user_email, subject, body):
        return False

    # Log event
    log_event(user_id, ticker, review_stage)
    time.sleep(0.1)

    # Calculate next review date
    next_interval = NEXT_INTERVALS.get(review_stage)
    next_stage = NEXT_STAGES.get(review_stage)

    if next_interval is not None:
        next_due = (datetime.utcnow().date() + timedelta(days=next_interval)).isoformat()
    else:
        next_due = None

    # Update entry
    update_data = {
        'review_stage': next_stage,
        'updated_at': datetime.utcnow().isoformat()
    }
    if next_due:
        update_data['next_review_due'] = next_due
    else:
        update_data['next_review_due'] = None

    supabase.from_('journal_meta').update(update_data).eq('id', entry_id).execute()
    time.sleep(0.1)

    print(f'✓ Sent reminder for {ticker} ({review_stage}) to {user_email}')
    return True


def main():
    """Main function"""
    print('Starting daily journal reminders...')

    # Get today's date
    today = datetime.utcnow().date().isoformat()

    # Query entries due today
    try:
        result = supabase.from_('journal_meta').select('*').eq('next_review_due', today).execute()
    except Exception as e:
        print(f'Error querying journal_meta: {e}')
        sys.exit(1)

    entries = result.data if result.data else []
    print(f'Found {len(entries)} entries due today')

    # Process each entry
    sent_count = 0
    for entry in entries:
        if process_journal_reminder(entry):
            sent_count += 1

    print(f'Journal reminders sent: {sent_count}')


if __name__ == '__main__':
    main()
