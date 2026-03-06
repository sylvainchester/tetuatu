import csv
import os
import re


INPUT_PATH = os.path.join("assets", "MySql", "tables1-9-10-11.sql")
OUTPUT_DIR = os.path.join("assets", "MySql", "pg")


TABLES = {
    "reponse_test1": {
        "target_columns": [
            "infinitif",
            "auxiliaire",
            "participe_passe",
            "present_je",
            "present_tu",
            "present_il",
            "present_nous",
            "present_vous",
            "present_ils",
            "futur_je",
            "futur_tu",
            "futur_il",
            "futur_nous",
            "futur_vous",
            "futur_ils",
            "imparfait_je",
            "imparfait_tu",
            "imparfait_il",
            "imparfait_nous",
            "imparfait_vous",
            "imparfait_ils",
            "passe_simple_je",
            "passe_simple_tu",
            "passe_simple_il",
            "passe_simple_nous",
            "passe_simple_vous",
            "passe_simple_ils",
            "traduction_en",
            "subjonctif_je",
            "subjonctif_tu",
            "subjonctif_il",
            "subjonctif_nous",
            "subjonctif_vous",
            "subjonctif_ils",
        ],
    },
    "reponse_test9_fr": {
        "target_columns": ["categorie", "phrase", "lecon"],
    },
    "reponse_test10": {
        "target_columns": ["titre", "langue", "niveau", "ref", "phrase"],
    },
    "reponse_test11": {
        "target_columns": ["langue", "niveau", "categorie", "question", "nombre_mots", "commentaire"],
    },
}


SCHEMA_SQL = """\
create extension if not exists "pgcrypto";

create table if not exists reponse_test1 (
  id bigserial primary key,
  infinitif text,
  auxiliaire text,
  participe_passe text,
  present_je text,
  present_tu text,
  present_il text,
  present_nous text,
  present_vous text,
  present_ils text,
  futur_je text,
  futur_tu text,
  futur_il text,
  futur_nous text,
  futur_vous text,
  futur_ils text,
  imparfait_je text,
  imparfait_tu text,
  imparfait_il text,
  imparfait_nous text,
  imparfait_vous text,
  imparfait_ils text,
  passe_simple_je text,
  passe_simple_tu text,
  passe_simple_il text,
  passe_simple_nous text,
  passe_simple_vous text,
  passe_simple_ils text,
  traduction_en text,
  subjonctif_je text,
  subjonctif_tu text,
  subjonctif_il text,
  subjonctif_nous text,
  subjonctif_vous text,
  subjonctif_ils text
);

create table if not exists reponse_test9_fr (
  id bigserial primary key,
  categorie text not null,
  phrase text not null,
  lecon text not null
);

create table if not exists reponse_test10 (
  id bigserial primary key,
  titre text not null,
  langue text not null,
  niveau text not null,
  ref text not null,
  phrase text not null
);

create index if not exists reponse_test10_ref_idx on reponse_test10 (ref);
create index if not exists reponse_test10_langue_niveau_idx on reponse_test10 (langue, niveau);

create table if not exists reponse_test11 (
  id bigserial primary key,
  langue text not null,
  niveau text not null,
  categorie text not null,
  question text not null,
  nombre_mots integer not null,
  commentaire text not null
);

create index if not exists reponse_test11_langue_cat_idx on reponse_test11 (langue, categorie);
"""


def parse_insert_values(values_blob):
    rows = []
    i = 0
    n = len(values_blob)
    while i < n:
        if values_blob[i] != "(":
            i += 1
            continue
        i += 1
        row = []
        val = ""
        in_str = False
        escape = False
        while i < n:
            ch = values_blob[i]
            if in_str:
                if escape:
                    if ch == "n":
                        val += "\n"
                    elif ch == "r":
                        val += "\r"
                    elif ch == "t":
                        val += "\t"
                    else:
                        val += ch
                    escape = False
                else:
                    if ch == "\\":
                        escape = True
                    elif ch == "'":
                        in_str = False
                    else:
                        val += ch
            else:
                if ch == "'":
                    in_str = True
                elif ch == ",":
                    row.append(_normalize_value(val))
                    val = ""
                elif ch == ")":
                    row.append(_normalize_value(val))
                    rows.append(row)
                    val = ""
                    i += 1
                    break
                else:
                    if ch not in " \n\r\t":
                        val += ch
            i += 1
    return rows


def _normalize_value(raw):
    cleaned = raw.strip()
    if not cleaned:
        return ""
    if cleaned.upper() == "NULL":
        return ""
    return cleaned


def extract_table_inserts(sql_text, table_name):
    pattern = re.compile(
        r"INSERT INTO `{table}`\s*\((.*?)\)\s*VALUES\s*(.*?);".format(table=re.escape(table_name)),
        re.S,
    )
    matches = pattern.findall(sql_text)
    inserts = []
    for columns_blob, values_blob in matches:
        columns = [col.strip().strip("`") for col in columns_blob.split(",")]
        rows = parse_insert_values(values_blob)
        inserts.append((columns, rows))
    return inserts


def write_csv(path, columns, rows):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as csvfile:
        writer = csv.writer(csvfile, quoting=csv.QUOTE_MINIMAL)
        writer.writerow(columns)
        for row in rows:
            writer.writerow(row)


def main():
    with open(INPUT_PATH, "r", encoding="utf-8", errors="ignore") as handle:
        sql_text = handle.read()

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    schema_path = os.path.join(OUTPUT_DIR, "schema.sql")
    with open(schema_path, "w", encoding="utf-8") as handle:
        handle.write(SCHEMA_SQL)

    for table, meta in TABLES.items():
        inserts = extract_table_inserts(sql_text, table)
        if not inserts:
            print(f"warning: no inserts found for {table}")
            continue
        target_cols = meta["target_columns"]
        output_rows = []
        for columns, rows in inserts:
            for row in rows:
                if len(row) != len(columns):
                    raise ValueError(f"column mismatch for {table}: {len(row)} vs {len(columns)}")
                if table == "reponse_test1":
                    # Use fixed positional mapping from dump columns.
                    mapped = [
                        row[0],
                        row[1],
                        row[2],
                        row[3],
                        row[4],
                        row[5],
                        row[6],
                        row[7],
                        row[8],
                        row[9],
                        row[10],
                        row[11],
                        row[12],
                        row[13],
                        row[14],
                        row[15],
                        row[16],
                        row[17],
                        row[18],
                        row[19],
                        row[20],
                        row[21],
                        row[22],
                        row[23],
                        row[24],
                        row[25],
                        row[26],
                        row[27],
                        row[28],
                        row[29],
                        row[30],
                        row[31],
                        row[32],
                        row[33],
                    ]
                    output_rows.append(mapped)
                elif table == "reponse_test11":
                    mapped = [row[0], row[1], row[2], row[3], row[4], row[5]]
                    output_rows.append(mapped)
                else:
                    output_rows.append(row)

        csv_path = os.path.join(OUTPUT_DIR, f"{table}.csv")
        write_csv(csv_path, target_cols, output_rows)
        print(f"wrote {csv_path} ({len(output_rows)} rows)")

    print(f"schema written to {schema_path}")


if __name__ == "__main__":
    main()
