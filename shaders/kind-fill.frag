#version 440
// A kind mark's status fill, masked by the mark (components/KindMark.qml):
// the tone, or with a motion the sweep gradient or the shimmer band over it.
// It draws what the mark's fill item drew under MultiEffect, but every motion
// is a uniform, so a moving mark renders no texture and asks for no extra
// frame. Compile with scripts/build-shaders.sh; kind-fill.frag.qsb is generated.
//
// Coordinates are logical pixels of the effect, which is the mark with `pad`
// on every side (the room MultiEffect's glow needs, kept so both paths line up).

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    vec4 tone;       // the fill colour, not premultiplied
    vec4 highlight;  // the sweep's lighter colour
    float sweep;     // the sweep's offset, 0 to 1, or < 0 without a sweep
    float band;      // the shimmer band's position, 0 to 1, or < 0 while it rests
    float pad;       // the margin around the mark
    float markWidth; // the mark's width
    float boxWidth;  // the effect's width (markWidth + 2 * pad)
    float boxHeight; // the effect's height
};

layout(binding = 1) uniform sampler2D mask;

const float BAND_TILT = 0.3490658503988659; // 20 degrees, clockwise

void main() {
    float x = qt_TexCoord0.x * boxWidth;
    float y = qt_TexCoord0.y * boxHeight;
    vec3 color = tone.rgb;

    // Sweep: a gradient twice the mark's width (tone, highlight, tone,
    // highlight, tone at even steps), its left edge at pad - markWidth * (1 - sweep).
    if (sweep >= 0.0) {
        float t = (x - (pad - markWidth * (1.0 - sweep))) / (2.0 * markWidth);
        if (t >= 0.0 && t <= 1.0) {
            float w = 1.0 - abs(2.0 * fract(2.0 * t) - 1.0);
            color = mix(tone.rgb, highlight.rgb, w);
        }
    }

    // Shimmer: a band 40% of the mark wide (2 px at least) and 1.6 times the
    // effect's height, turned 20 degrees about its centre, fading from clear to
    // white at 0.9 in its middle, drawn over the colour.
    if (band >= 0.0) {
        float bandWidth = max(2.0, markWidth * 0.4);
        float cx = pad - bandWidth + (markWidth + bandWidth) * band + bandWidth * 0.5;
        float cy = boxHeight * 0.5;
        float dx = x - cx;
        float dy = y - cy;
        float lx = dx * cos(BAND_TILT) + dy * sin(BAND_TILT);
        float ly = -dx * sin(BAND_TILT) + dy * cos(BAND_TILT);
        if (abs(lx) <= bandWidth * 0.5 && abs(ly) <= boxHeight * 0.8) {
            float a = 0.9 * (1.0 - abs(2.0 * (lx / bandWidth + 0.5) - 1.0));
            color = vec3(a) + color * (1.0 - a);
        }
    }

    // MultiEffect's mask at its default thresholds covers every texel the mark
    // touches at all, so edges and thin gaps fill in; the same here, so a mark
    // keeps its shape when it moves between this and the glow's MultiEffect.
    float coverage = step(0.0001, texture(mask, qt_TexCoord0).a);
    fragColor = vec4(color * tone.a, tone.a) * coverage * qt_Opacity;
}
