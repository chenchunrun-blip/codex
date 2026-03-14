#!/bin/sh
set -e

echo "Starting MarqDex application..."

# Wait for database to be ready
if [ -n "$DATABASE_URL" ]; then
  echo "Waiting for database connection..."
  until npx prisma db pull --schema=/app/prisma/schema.prisma > /dev/null 2>&1; do
    echo "Database is unavailable - sleeping"
    sleep 2
  done
  echo "Database is connected!"

  # Run migrations
  echo "Running database migrations..."
  npx prisma migrate deploy --schema=/app/prisma/schema.prisma
  echo "Migrations completed!"
fi

# Start the application
echo "Starting Next.js server..."
exec "$@"
