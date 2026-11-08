"""Overwatch perception: turns drone footage into evidence (Denny's package).

Detection runs ahead of time (`precompute`). The sidecar JSON and crops it writes are committed,
and the live demo replays them (`replay`, `emit`), so nobody else needs PyTorch. Heavy imports
(torch, ultralytics, sahi, cv2) happen inside functions, never when a module is imported.
"""
