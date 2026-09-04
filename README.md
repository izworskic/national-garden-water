# National Garden Water

A no-login garden watering decision tool for the United States.

**Question answered:** Do I need to water today? If so, how much?

The model treats the crop root zone as a water reservoir and combines:
- NWS quantitative precipitation forecast and Forecast Reference Evapotranspiration (FRET);
- recent NWS station precipitation when available;
- USDA NRCS Soil Data Access available-water properties;
- crop/stage coefficients and rooting depth;
- bed/container and mulch modifiers;
- gardener-entered irrigation, rain-gauge and optional soil-feel observations.

Primary decisions are `WATER TODAY`, `WAIT`, `CHECK SOIL FIRST`, and `HOLD FOR RAIN`.

Canonical target: `https://chrisizworski.com/national-tools/garden-water/`
