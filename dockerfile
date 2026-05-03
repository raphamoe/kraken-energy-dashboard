FROM python:3.12-alpine

# Alpine uses addgroup/adduser with different flags
RUN addgroup -g 1000 appuser && \
    adduser -u 1000 -G appuser -D -s /bin/sh appuser

WORKDIR /app

# Install build dependencies (only if you have C-based requirements like psutil/cryptography)
# RUN apk add --no-cache gcc musl-dev linux-headers

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p /app/data && \
    chown -R appuser:appuser /app

USER appuser
EXPOSE 5000

CMD ["gunicorn", "-w", "1", "--threads", "2", "-b", "0.0.0.0:5000", "app:app"]