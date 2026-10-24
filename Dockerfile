FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssh-client && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY vpshelf ./vpshelf
RUN useradd --create-home --uid 10001 shelf && mkdir /app/data && chown shelf:shelf /app/data
USER shelf
EXPOSE 8765
CMD ["python", "-m", "vpshelf.app", "--host", "0.0.0.0"]
