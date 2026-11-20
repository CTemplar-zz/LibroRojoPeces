"""Convert the supplied WGS84 mining shapefile to a 2D web layer (requires pyshp)."""
import argparse
import json
import math
from pathlib import Path

import shapefile


def prepare(source, destination):
    # Refuse other coordinate systems rather than silently assigning WGS84.
    projection = source.with_suffix('.prj').read_text(encoding='utf-8')
    if 'PROJCS[' in projection or 'GEOGCS["GCS_WGS_1984"' not in projection:
        raise ValueError('The source must be geographic WGS84; reproject it before exporting.')
    reader = shapefile.Reader(str(source), encoding='utf-8')
    features = []

    def xy(coords):
        if coords and isinstance(coords[0], (float, int)):
            x, y = coords[:2]
            if not (math.isfinite(x) and math.isfinite(y) and -180 <= x <= 180 and -90 <= y <= 90):
                raise ValueError('Invalid WGS84 coordinate')
            return [x, y]
        return [xy(c) for c in coords]

    for index, item in enumerate(reader.iterShapeRecords()):
        if item.shape.shapeType not in (shapefile.POLYGON, shapefile.POLYGONM, shapefile.POLYGONZ):
            raise ValueError(f'Non-polygon or empty geometry in record {index}')
        geometry = item.shape.__geo_interface__
        features.append({
            'type': 'Feature', 'id': index,
            'properties': {'id': index, **item.record.as_dict()},
            'geometry': {'type': geometry['type'], 'coordinates': xy(geometry['coordinates'])},
        })
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps({'type': 'FeatureCollection', 'features': features},
                                     ensure_ascii=False, separators=(',', ':'), allow_nan=False), encoding='utf-8')
    print(json.dumps({'features': len(features), 'bytes': destination.stat().st_size}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    prepare(args.source, args.destination)
