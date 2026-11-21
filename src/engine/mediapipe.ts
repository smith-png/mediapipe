import {
  FaceLandmarker,
  FilesetResolver,
  GestureRecognizer,
  ImageSegmenter,
} from '@mediapipe/tasks-vision';

// Matches the installed @mediapipe/tasks-vision version
const WASM_CDN_BASE =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm';

const FACE_LANDMARKER_MODEL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

const GESTURE_RECOGNIZER_MODEL =
  'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task';

const SELFIE_SEGMENTER_MODEL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';

type Delegate = 'GPU' | 'CPU';
type VisionFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

async function createWithGpuFallback<T>(
  factory: (delegate: Delegate) => Promise<T>
): Promise<{ instance: T; delegate: Delegate }> {
  try {
    const instance = await factory('GPU');
    return { instance, delegate: 'GPU' };
  } catch (gpuError) {
    console.warn('GPU delegate unavailable, falling back to CPU:', gpuError);
    const instance = await factory('CPU');
    return { instance, delegate: 'CPU' };
  }
}

export class VisionEngine {
  private fileset: VisionFileset | null = null;
  private faceLandmarker: FaceLandmarker | null = null;
  private imageSegmenter: ImageSegmenter | null = null;
  private gestureRecognizer: GestureRecognizer | null = null;
  private gestureInitPromise: Promise<GestureRecognizer> | null = null;
  private personMaskIndex = 0;
  private disposed = false;

  async init(loadGestureInitially: boolean): Promise<void> {
    this.fileset = await FilesetResolver.forVisionTasks(WASM_CDN_BASE);
    if (this.disposed) return;

    const tasks: Promise<void>[] = [
      this.initFaceLandmarker(),
      this.initImageSegmenter(),
    ];

    if (loadGestureInitially) {
      tasks.push(this.ensureGestureRecognizer().then(() => undefined));
    }

    await Promise.all(tasks);
  }

  private async initFaceLandmarker(): Promise<void> {
    if (!this.fileset) return;
    const { instance } = await createWithGpuFallback((delegate) =>
      FaceLandmarker.createFromOptions(this.fileset!, {
        baseOptions: {
          modelAssetPath: FACE_LANDMARKER_MODEL,
          delegate,
        },
        runningMode: 'VIDEO',
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: false,
        numFaces: 1,
        minFaceDetectionConfidence: 0.45,
        minFacePresenceConfidence: 0.45,
        minTrackingConfidence: 0.45,
      })
    );

    if (this.disposed) {
      instance.close();
      return;
    }
    this.faceLandmarker = instance;
  }

  private async initImageSegmenter(): Promise<void> {
    if (!this.fileset) return;
    const { instance } = await createWithGpuFallback((delegate) =>
      ImageSegmenter.createFromOptions(this.fileset!, {
        baseOptions: {
          modelAssetPath: SELFIE_SEGMENTER_MODEL,
          delegate,
        },
        runningMode: 'VIDEO',
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      })
    );

    if (this.disposed) {
      instance.close();
      return;
    }

    this.imageSegmenter = instance;
    this.personMaskIndex = this.resolvePersonMaskIndex(instance);
  }

  private resolvePersonMaskIndex(segmenter: ImageSegmenter): number {
    try {
      const labels = segmenter.getLabels();
      if (labels.length >= 2) {
        const personIdx = labels.findIndex((label) => {
          const lower = label.toLowerCase();
          return (
            lower.includes('person') ||
            lower.includes('selfie') ||
            lower.includes('foreground')
          );
        });
        if (personIdx >= 0) return personIdx;
        // If index 0 is background, index 1 is foreground person
        if (labels[0]?.toLowerCase().includes('background')) return 1;
      }
    } catch {
      // Fall back to default index
    }
    return 0;
  }

  /**
   * Lazily initializes GestureRecognizer only when a hand-gesture trigger is selected.
   */
  async ensureGestureRecognizer(): Promise<GestureRecognizer | null> {
    if (this.disposed) return null;
    if (this.gestureRecognizer) return this.gestureRecognizer;
    if (this.gestureInitPromise) return this.gestureInitPromise;

    if (!this.fileset) {
      this.fileset = await FilesetResolver.forVisionTasks(WASM_CDN_BASE);
    }

    const fileset = this.fileset;
    this.gestureInitPromise = createWithGpuFallback((delegate) =>
      GestureRecognizer.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: GESTURE_RECOGNIZER_MODEL,
          delegate,
        },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.45,
        minHandPresenceConfidence: 0.45,
        minTrackingConfidence: 0.45,
      })
    )
      .then(({ instance }) => {
        if (this.disposed) {
          instance.close();
          return instance;
        }
        this.gestureRecognizer = instance;
        return instance;
      })
      .catch((err) => {
        this.gestureInitPromise = null;
        throw err;
      });

    return this.gestureInitPromise;
  }

  getFaceLandmarker(): FaceLandmarker | null {
    return this.faceLandmarker;
  }

  getImageSegmenter(): ImageSegmenter | null {
    return this.imageSegmenter;
  }

  getGestureRecognizer(): GestureRecognizer | null {
    return this.gestureRecognizer;
  }

  getPersonMaskIndex(): number {
    return this.personMaskIndex;
  }

  dispose(): void {
    this.disposed = true;
    try {
      this.faceLandmarker?.close();
    } catch {
      // Ignore cleanup errors
    }
    try {
      this.imageSegmenter?.close();
    } catch {
      // Ignore cleanup errors
    }
    try {
      this.gestureRecognizer?.close();
    } catch {
      // Ignore cleanup errors
    }
    this.faceLandmarker = null;
    this.imageSegmenter = null;
    this.gestureRecognizer = null;
    this.gestureInitPromise = null;
    this.fileset = null;
  }
}
