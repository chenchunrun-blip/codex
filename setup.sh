#!/bin/bash

# Security Alert Triage System - Setup Script

echo "=========================================="
echo "Security Alert Triage System Setup"
echo "=========================================="
echo ""

# Check Python version
echo "1. Checking Python version..."
python3 --version || { echo "❌ Python 3 is required!"; exit 1; }
echo "✓ Python version OK"
echo ""

# Create virtual environment (optional)
echo "2. Creating virtual environment..."
read -p "Do you want to create a virtual environment? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    python3 -m venv venv
    source venv/bin/activate
    echo "✓ Virtual environment created and activated"
fi
echo ""

# Install dependencies
echo "3. Installing dependencies..."
pip install -r requirements.txt || { echo "❌ Failed to install dependencies"; exit 1; }
echo "✓ Dependencies installed"
echo ""

# Create .env file
echo "4. Setting up environment variables..."
if [ ! -f .env ]; then
    cp .env.example .env
    echo "✓ Created .env file"
    echo "⚠️  Please edit .env and add your OPENAI_API_KEY"
else
    echo "✓ .env file already exists"
fi
echo ""

# Create necessary directories
echo "5. Creating directories..."
mkdir -p logs
mkdir -p data/vector_store
echo "✓ Directories created"
echo ""

# Run test
echo "6. Running system test..."
echo "=========================================="
python main.py --sample
echo "=========================================="
echo ""

echo "✅ Setup completed!"
echo ""
echo "Next steps:"
echo "  1. Edit .env file and add your OPENAI_API_KEY"
echo "  2. Run: python main.py --help"
echo "  3. Try interactive mode: python main.py --interactive"
echo ""
