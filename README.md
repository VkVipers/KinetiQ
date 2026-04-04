# KinetiQ
Demo: https://kineti-q-hutb.vercel.app/delivery/be6fbe83/analytics

<img width="1865" height="991" alt="image" src="https://github.com/user-attachments/assets/a613dc7d-fd3f-44f7-913d-024239b87858" />

Context-Aware Fleet Tracking for Optimal Routing and Driver Evaluation 
## The Problem

Right now, most tracking systems can only tell you if your goods got bumped during a trip, leaving out the most important part: the cause. Was the driver being careless, or was it just a terrible road? This lack of context leads to high financial losses from cargo damage and the unfair penalization of safe drivers for unavoidable road hazards. 

## Our Solution

KinetiQ deploys an intelligent telematics system that combines edge IoT data with fleet-wide cloud analytics to separate road-induced anomalies from driver-induced anomalies. We are moving the industry away from absolute metrics to contextual accountability. 
How it Works: The Mechanism

    Data Capture: A lightweight IoT device (IMU + GPS) tracks vertical jolts, harsh braking, and sharp cornering. 

    Contextual Analytics: By cross-referencing telemetry across multiple vehicles, we map the physical reality of the route. If one truck registers erratic lateral shifts, it is flagged as aggressive driving. If ten trucks register a severe vertical impact at the exact same GPS coordinate, it is mapped as an environmental cause. 

    Crowdsourcing Infrastructure: We turn existing delivery fleets into active, real-time road quality scanners without requiring expensive surveying equipment. 

## Core Outcomes

    Cargo-Aware Dynamic Routing: We match the route to the freight. Fragile shipments are directed along paths with the lowest historical "jitter scores," while durable goods take the fastest available paths. 

    The Driver Trust Network: We generate a "Driver Reliability Score" based strictly on preventable actions (e.g., sudden braking on a known smooth road). This provides fine-grained, fair analytics to streamline hiring, reduce turnover, and reward good driving. 

## Technology Stack

    Hardware / Edge: Microcontroller (ESP32), 6-axis IMU, GPS Module, Camera Module 

    Data & Cloud: MQTT protocol, AWS/GCP hosting, Time-Series Database (InfluxDB) 

    Analytics Engine: Python-based spatial clustering algorithms 

    Edge Vision: Lightweight Object Detection models (YOLOv8 Nano) running on edge devices
