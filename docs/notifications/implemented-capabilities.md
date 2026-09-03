# Notification capabilities

## Implemented

- A signed-in user can register a web or native device token for push notifications.
- The recurring-expense job creates a notification after it creates a recurring expense.
- Failed push deliveries are retried by the backend retry job.

## Not implemented

- Real-time budget-threshold alerts.
- User-configured thresholds, quiet hours, or notification privacy preferences.
- Subscription or upcoming-payment reminders.

The notification consent prompt must describe only the implemented recurring-expense reminder behavior. Budget-alert copy must not be added until a threshold producer, delivery behavior, user controls, and tests are implemented.
