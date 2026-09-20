#!/usr/bin/env swift

// Run from the application directory on macOS:
//   swift scripts/export-wordmark.swift
// Export the shared dot wtf identity for tekID as rounded semibold outlines.
// No font file is bundled, embedded, or required to display the generated SVGs.

import AppKit
import CoreText
import Foundation

let fontSize: CGFloat = 100
let tracking = -0.03 * fontSize
let symbolSize = 0.56 * fontSize
let symbolMargin = 0.04 * fontSize
let padding = 0.04 * fontSize
// Logto fixes the image box at 40px high. Keep the artwork at 32px by adding
// transparent vertical padding to the SVG canvas, without changing its scale.
let contentHeight: CGFloat = 32
let displayHeight: CGFloat = 40

guard let descriptor = NSFont.systemFont(ofSize: fontSize, weight: .semibold)
    .fontDescriptor.withDesign(.rounded),
    let font = NSFont(descriptor: descriptor, size: fontSize) else {
    fatalError("SF Pro Rounded semibold is unavailable on this system.")
}

func number(_ value: CGFloat) -> String {
    let rounded = abs(value) < 0.0005 ? 0 : value
    return String(format: "%.3f", Double(rounded))
        .replacingOccurrences(of: #"\.?0+$"#, with: "", options: .regularExpression)
}

func shape(_ text: String, at x: CGFloat) -> CGPath {
    let attributed = NSAttributedString(string: text, attributes: [
        .font: font,
        .kern: tracking,
    ])
    let line = CTLineCreateWithAttributedString(attributed)
    let combined = CGMutablePath()

    for case let run as CTRun in CTLineGetGlyphRuns(line) as NSArray {
        let count = CTRunGetGlyphCount(run)
        var glyphs = [CGGlyph](repeating: 0, count: count)
        var positions = [CGPoint](repeating: .zero, count: count)
        CTRunGetGlyphs(run, CFRange(location: 0, length: 0), &glyphs)
        CTRunGetPositions(run, CFRange(location: 0, length: 0), &positions)

        let attributes = CTRunGetAttributes(run) as NSDictionary
        let runFont = attributes[kCTFontAttributeName] as! CTFont
        for index in 0..<count {
            guard let glyphPath = CTFontCreatePathForGlyph(runFont, glyphs[index], nil) else {
                fatalError("Missing outline for \(text), glyph \(index).")
            }
            let transform = CGAffineTransform(
                a: 1, b: 0, c: 0, d: -1,
                tx: x + positions[index].x, ty: -positions[index].y
            )
            combined.addPath(glyphPath, transform: transform)
        }
    }

    return combined
}

func svgPath(_ path: CGPath, translatedBy offset: CGPoint) -> String {
    var transform = CGAffineTransform(translationX: offset.x, y: offset.y)
    guard let translated = path.copy(using: &transform) else {
        fatalError("Cannot position wordmark outlines.")
    }
    var commands: [String] = []
    func point(_ p: CGPoint) -> String { "\(number(p.x)) \(number(p.y))" }

    translated.applyWithBlock { pointer in
        let element = pointer.pointee
        switch element.type {
        case .moveToPoint:
            commands.append("M\(point(element.points[0]))")
        case .addLineToPoint:
            commands.append("L\(point(element.points[0]))")
        case .addQuadCurveToPoint:
            commands.append("Q\(point(element.points[0])) \(point(element.points[1]))")
        case .addCurveToPoint:
            commands.append("C\(point(element.points[0])) \(point(element.points[1])) \(point(element.points[2]))")
        case .closeSubpath:
            commands.append("Z")
        @unknown default:
            fatalError("Unsupported outline command.")
        }
    }
    return commands.joined()
}

let symbolX: CGFloat = 0
// Like CSS vertical-align: middle, center the mark on half the font's x-height.
let symbolY = -font.xHeight / 2 - symbolSize / 2
let lettering = shape("wtf", at: symbolX + symbolSize + symbolMargin)
let symbolScale = symbolSize / 16
// Exact visible bounds of BrandExpansionMark, including its rounded strokes.
let symbolBounds = CGRect(
    x: symbolX + 1.2 * symbolScale,
    y: symbolY + 1.13 * symbolScale,
    width: 13.61 * symbolScale,
    height: 13.48 * symbolScale
)
let bounds = lettering.boundingBoxOfPath.union(symbolBounds)
let offset = CGPoint(x: padding - bounds.minX, y: padding - bounds.minY)
let width = bounds.width + 2 * padding
let height = bounds.height + 2 * padding
let displayWidth = width / height * contentHeight
let canvasHeight = height * displayHeight / contentHeight
let canvasY = -(canvasHeight - height) / 2
let letteringPath = svgPath(lettering, translatedBy: offset)

for (filename, color) in [
    ("dot-wtf-wordmark.svg", "#1a1a1a"),
    ("dot-wtf-wordmark-dark.svg", "#eeeeec"),
] {
    let svg = """
    <svg xmlns="http://www.w3.org/2000/svg" width="\(number(displayWidth))" height="\(number(displayHeight))" viewBox="0 \(number(canvasY)) \(number(width)) \(number(canvasHeight))" role="img" aria-label="dot wtf">
      <title>dot wtf</title>
      <g fill="\(color)">
        <g transform="translate(\(number(symbolX + offset.x)) \(number(symbolY + offset.y))) scale(\(number(symbolScale)))">
          <g transform="translate(3.25 2.82) scale(.62)">
            <path d="M7.35 8.45 6.55 1.45M7.35 8.45l4.6-5.8M7.35 8.45l7-1.4M7.35 8.45l4.9 4.5M7.35 8.45l.37 6.05M7.35 8.45l-4.8 3.75M7.35 8.45l-5.9-.77" fill="none" stroke="\(color)" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.35"/>
            <circle cx="7.35" cy="8.45" r="1.65"/>
          </g>
          <circle cx="8" cy="1.65" r=".52"/>
          <circle cx="13.78" cy="5.36" r=".52"/>
          <circle cx="14.29" cy="8.9" r=".52"/>
          <circle cx="12.8" cy="12.16" r=".52"/>
          <circle cx="9.79" cy="14.09" r=".52"/>
          <circle cx="6.21" cy="14.09" r=".52"/>
          <circle cx="3.2" cy="12.16" r=".52"/>
          <circle cx="1.72" cy="8.9" r=".52"/>
          <circle cx="2.22" cy="5.36" r=".52"/>
          <circle cx="4.57" cy="2.66" r=".52"/>
          <circle cx="14" cy="2.05" r=".7"/>
        </g>
        <path d="\(letteringPath)"/>
      </g>
    </svg>
    """ + "\n"
    let target = URL(fileURLWithPath: "public").appendingPathComponent(filename)
    try svg.write(to: target, atomically: true, encoding: .utf8)
    print("\(target.lastPathComponent): \(svg.utf8.count) bytes; \(number(displayWidth))×\(number(displayHeight)) canvas, \(number(contentHeight))px artwork; viewBox 0 \(number(canvasY)) \(number(width)) \(number(canvasHeight)); \(font.fontName)")
}
