"""Prepare the reviewed three-source CSV for a separate immutable portal import."""
import argparse
import csv
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path


def prepare(source, catalog_file, destination):
    catalog = json.loads(catalog_file.read_text(encoding='utf-8'))
    names = {s['name'].strip().casefold(): s['id'] for s in catalog}
    grouped = defaultdict(list)
    counts = Counter()
    ids = set()
    source_names = {'ICTIO2024': 'ICTIO', 'SantosMercado_Pando': 'SantosMercado Pando', 'Peces_final': 'Peces final'}
    with source.open(encoding='utf-8-sig', newline='') as f:
        for row in csv.DictReader(f):
            species = names[row['ESPECIE'].strip().casefold()]
            identity = '|'.join(['consolidado-20261120', row['BASE_DAT'], row['HOJA_XLS'], row['FILA_XLS'], row['ID_ORIG']])
            identifier = hashlib.sha256(identity.encode('utf-8')).hexdigest()[:20]
            assert identifier not in ids
            ids.add(identifier)
            flags = []
            if row['VALIDACION'].lower() == 'no':
                flags.append('Validación de origen: No')
            if row['CONF_GEO']:
                flags.append('Confiabilidad geográfica de origen: ' + row['CONF_GEO'])
            point = {'id': identifier, 'x': float(row['LONGITUD']), 'y': float(row['LATITUD']),
                     'source': source_names[row['BASE_DAT']], 'database': row['BASE_DAT'], 'author': row['FUENTE'],
                     'year': int(row['ANIO']) if row['ANIO'] else None,
                     'publicationYear': int(row['ANIO_PUB']) if row['ANIO_PUB'] else None,
                     'url': row['URL'], 'date': row['FECHA'] or row['ANIO'], 'quality': row['VALIDACION'],
                     'precision': None, 'flags': flags, 'detail': row['OBS_GEO'], 'type': '', 'catalog': row['ID_ORIG'],
                     'originalSpecies': row['ESP_ORIG'], 'department': row['DEPTO'], 'locality': row['LOCALIDAD'],
                     'reference': row['REFERENCIA_COMPLETA'], 'sourceSheet': row['HOJA_XLS'], 'sourceRow': int(row['FILA_XLS']),
                     'importBatch': 'consolidado-20261120'}
            grouped[species].append(point)
            counts[row['BASE_DAT']] += 1
    assert sum(counts.values()) == 18318 and len(grouped) == 92
    destination.mkdir(parents=True, exist_ok=True)
    for species, points in grouped.items():
        (destination / (species + '.json')).write_text(json.dumps({'species': species, 'points': points},
              ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    manifest = {'version': '20261123', 'total': sum(counts.values()), 'sourceCounts': dict(counts),
                'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
                'species': {k: len(v) for k, v in sorted(grouped.items())}}
    (destination / 'index.json').write_text(json.dumps(manifest, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'species': len(grouped), 'points': manifest['total'], 'sources': dict(counts),
                      'largest': sorted([(k, len(v)) for k, v in grouped.items()], key=lambda x: -x[1])[:4]}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('catalog', type=Path)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    prepare(args.source, args.catalog, args.destination)
