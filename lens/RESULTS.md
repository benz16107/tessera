# Lens reader results

Test split: whole landmarks the model never saw (london_bigben, nyc_dumbo, toronto_gooderham), 480 photos. The headline is bin accuracy.

| Reader | Bin accuracy | Median abs % error | Within 25% | NYC DUMBO bin acc | Answered |
|---|---|---|---|---|---|
| Typical at landmark (train median, else global) | 17.1% | 29.6% | 43.5% | 15.3% (n=268) | 480/480 |
| Typical at landmark (leave-one-out on test, optimistic) | 55.2% | 16.7% | 55.4% | 68.7% (n=268) | 480/480 |
| Always 'wide' | 57.5% | 16.7% | 60.4% | 68.7% (n=268) | 480/480 |
| OpenAI gpt-6.1-sol (zero-shot) | 68.3% | 13.8% | 67.7% | 75.7% (n=268) | 480/480 |

## Dataset

| Split | ultrawide | wide | normal | tele | super-tele | total |
|---|---|---|---|---|---|---|
| train | 479 | 1286 | 652 | 910 | 207 | 3534 |
| val | 22 | 197 | 83 | 127 | 57 | 486 |
| test | 35 | 276 | 82 | 76 | 11 | 480 |

## Notes

- The f35 label is EXIF FocalLengthIn35mmFilm times DigitalZoomRatio when the ratio is above 1, except on Apple files, whose tag already includes the zoom. EXIF is a noisy reference.
- NYC DUMBO is over half of the test split, so overall numbers lean on it. The 'Always wide' row is the bar a lens reader must clear; the landmark-prior rows need photos from the landmark itself.
- Super-tele has few test photos, so read per-bin results with care.
- The leave-one-out landmark row reads other test photos of the same landmark, so it is an optimistic ceiling for a landmark prior. A new landmark cannot use it.
- Zero-shot models get the image and a prompt asking for strict JSON. The fine-tuned model gets its training prompt.
