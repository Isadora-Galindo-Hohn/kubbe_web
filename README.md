# Kubbe web

This project displays model output from different analytical modals.
With the case provided being the flooding incident in kubbe september 2025.
The study looked at 22 different models and parameters all available to look at separatly via the web based maps.

## Web maps
The data is displayed by web maps by leaflet, a JS library for working with web-based maps.
The custom time controls and case/layer controls where created using the built in Leaflet bindings for creating different controls.

### Layer control
The cases/layers are grouped into three categories, Base cases, sensitivity cases and combindes cases.
Base cases tests different rainfall forcing data. Sensitivity cases tests the sensivity of different parameters for the models, and combined cases tests both pluvial and fluvial models.
With the custom controls we can hide and show all cases but also compact and expand the categories.
The available layers and categories are all controled via configs generated at build time.

### Time slider
Using manifests generated at build time the time slider will get the range of dates available.

![Showcasing the map over kubbe with the leaflet controls.](/images/before-flooding.png)

## Data
To display the input files we first needed to reproject the data from SWEREF99 TM to EPSG:3857 since we were using openstreetmaps as the map layer.

### Why not using PNGs?
We decided to use SVG based files to display the data since it scales when zooming without bringing the complexity of using tile based projection with PNGs.
However if this was a bigger project the use of big svg files would not scale performance wise and you would probably want to use tile based data/images.

### Data sources
Both the input and output files are to big to host on github so for now they are not accessible.
The paths in scripts are also hard coded so it couldn't be run outside the intended build environment.

![Showcasing the output from all combined cases during th flooding.](/images/during-flooding-combined.png)
