.PHONY: dev start compile-server frontend help

# Start both frontend dev server and compilation server
dev:
	@echo "Starting frontend dev server (port 8082) and compilation server..."
	@npx concurrently "npm run compile-server" "expo start --web --port 8082"

# Start only the compilation server
compile-server:
	@echo "Starting compilation server..."
	npm run compile-server

# Start only the frontend dev server
frontend:
	@echo "Starting frontend dev server on port 8082..."
	expo start --web --port 8082

# Default target
start: dev

# Help target
help:
	@echo "Available commands:"
	@echo "  make dev           - Start both frontend dev server and compilation server"
	@echo "  make start         - Alias for 'make dev'"
	@echo "  make compile-server - Start only the compilation server"
	@echo "  make frontend      - Start only the frontend dev server"
	@echo "  make help          - Show this help message"

