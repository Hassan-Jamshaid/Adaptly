"""
Tests for text chunking.

Two defects prompted these:

1. The old splitter used raw_text.split(". "), which DELETED every full stop.
   A sentence went in with punctuation and came out without it, so stored
   content read as one long run-on. It was invisible only because nothing in
   the application displays content yet.

2. The same split treated "Dr. Smith" as a sentence boundary.

They also lock in the two shape changes agreed in the shared-contract review:
chunk_id is a STRING, and every chunk carries an explicit `order`.

Run from backend/:   python -m pytest tests/ -v
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.text_processing import chunk_text, split_sentences  # noqa: E402


# ---------------------- punctuation is preserved ----------------------

def test_full_stops_are_not_deleted():
    text = "The cat sat on the mat. The dog barked loudly. It was fine."
    joined = " ".join(c["text"] for c in chunk_text(text))
    assert joined.count(".") == text.count("."), "full stops must survive chunking"


def test_question_and_exclamation_marks_survive():
    text = "What is engagement? It is attention! That is all."
    joined = " ".join(c["text"] for c in chunk_text(text))
    assert "?" in joined and "!" in joined


def test_abbreviations_do_not_split_a_sentence():
    assert len(split_sentences("Dr. Smith arrived early.")) == 1
    assert len(split_sentences("Use e.g. this method here.")) == 1
    assert len(split_sentences("See Fig. 3 for details.")) == 1


def test_initials_do_not_split_a_sentence():
    assert len(split_sentences("A. Gupta wrote the paper.")) == 1


def test_real_sentences_still_split():
    assert len(split_sentences("First one. Second one. Third one.")) == 3


# ---------------------- chunk shape (shared contract) ----------------------

def test_chunk_id_is_a_string():
    chunks = chunk_text("One. Two. Three.")
    assert all(isinstance(c["chunk_id"], str) for c in chunks)


def test_every_chunk_has_an_order():
    chunks = chunk_text(" ".join(f"Sentence number {i} here." for i in range(200)))
    assert [c["order"] for c in chunks] == list(range(len(chunks)))


def test_order_is_an_integer_starting_at_zero():
    chunks = chunk_text("One. Two.")
    assert chunks[0]["order"] == 0
    assert isinstance(chunks[0]["order"], int)


def test_chunk_has_exactly_the_expected_keys():
    for c in chunk_text("One sentence here. Another one there."):
        assert set(c.keys()) == {"chunk_id", "order", "text"}


# ---------------------- sizing behaviour ----------------------

def test_chunks_respect_the_word_limit():
    text = " ".join(f"This is sentence number {i} of the document." for i in range(300))
    for c in chunk_text(text, max_words=120):
        assert len(c["text"].split()) <= 120 + 20, "chunks stay near the limit"


def test_sentences_are_never_cut_in_half():
    text = " ".join(f"Sentence {i} runs to here." for i in range(100))
    for c in chunk_text(text, max_words=30):
        assert c["text"].rstrip().endswith("."), "a chunk must end on a sentence end"


def test_short_text_makes_one_chunk():
    assert len(chunk_text("Just one short sentence.")) == 1


def test_chunk_count_scales_with_length():
    short = chunk_text(" ".join(["Word here and there."] * 30), max_words=120)
    long = chunk_text(" ".join(["Word here and there."] * 300), max_words=120)
    assert len(long) > len(short)


# ---------------------- edge cases ----------------------

def test_empty_text_produces_no_chunks():
    assert chunk_text("") == []
    assert chunk_text("   \n  ") == []


def test_newlines_are_flattened():
    assert "\n" not in chunk_text("Line one.\nLine two.\n\nLine three.")[0]["text"]


def test_text_without_final_punctuation_still_works():
    chunks = chunk_text("This has no full stop at the end")
    assert len(chunks) == 1
    assert "no full stop" in chunks[0]["text"]
