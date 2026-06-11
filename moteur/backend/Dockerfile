FROM python:3.12-slim

WORKDIR /app

# Dépendances système
RUN apt-get update && apt-get install -y gcc libpq-dev && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Le code partagé (scrapers, generators) est monté via volume en dev
# En prod il sera copié dans /app/shared

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
