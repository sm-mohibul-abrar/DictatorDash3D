FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PORT=10000
EXPOSE 10000

# Install Mesa OpenGL rasterizer, FreeGLUT, virtual displays, X utilities, and noVNC
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-opengl \
    freeglut3-dev \
    libglu1-mesa \
    libgl1-mesa-glx \
    libgl1-mesa-dri \
    xvfb \
    x11-utils \
    x11vnc \
    novnc \
    websockify \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Standard PyOpenGL install (clean and stable across Python 3.10)
RUN pip3 install --no-cache-dir PyOpenGL

# Copy deployment assets and decouple filename by standardizing as game.py
COPY 11.py /app/game.py
COPY start.sh /app/start.sh

# The virtual screen is exactly 1100x700, so open the window at 0,0 instead of 60,40
# (otherwise its right/bottom edge falls off-screen in the stream)
RUN sed -i 's/glutInitWindowPosition(60, 40)/glutInitWindowPosition(0, 0)/' /app/game.py

# Hosts such as Hugging Face Spaces run the container as a non-root user:
# pre-create the X socket directory so Xvfb can start without root
RUN mkdir -p /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix

# Embed immediate auto-connect and auto-scale into index.html
RUN echo '<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0; url=/vnc.html?autoconnect=true&resize=scale" /></head><body></body></html>' > /usr/share/novnc/index.html

# Fix line endings, make executable, and ensure open permissions for container hosts
RUN sed -i 's/\r$//' /app/start.sh && chmod +x /app/start.sh && chmod -R 777 /app /tmp && chmod 1777 /tmp/.X11-unix

CMD ["/app/start.sh"]