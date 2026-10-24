# 🎮 GeForce 3D Explorer & Data Analytics Pipeline

An end-to-end Data Analytics and 3D Web Visualization platform analyzing specifications, compute performance, and market pricing for **46 NVIDIA GeForce Desktop GPUs** across 5 microarchitectures (Pascal to Blackwell).

---

## 🌟 Project Overview & Architecture

This project connects **offline Python data science (ETL & EDA)** with an **interactive modern web frontend (Three.js & Chart.js)**:

```text
┌─────────────────────────┐
│ Raw GPU Spec Datasets   │ (Kaggle / Retail Listings)
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ Python Pipeline & EDA   │ ──> gpu_data_analysis.ipynb & pipeline.py
│ (Pandas, NumPy, Seaborn)│     - Data auditing, cleaning, handling corrupt schema
└────────────┬────────────┘     - Feature engineering: FP32 TFLOPS & Value Metrics
             │
             ▼
┌─────────────────────────┐
│ Clean Curated Dataset   │ ──> nvidia_gpus_clean.csv (46 Models)
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ Interactive Web App     │ ──> index.html & app.js
│ (Three.js, Chart.js)    │     - 3D GPU teardown & inspection (Die, VRAM, Cooling)
└─────────────────────────┘     - Dynamic scatter plot (log scale), ranking bar & radar
```

---

## 🛠️ Tech Stack

| Layer | Technologies Used |
|---|---|
| **Data Processing & EDA** | Python 3, Pandas, NumPy, Jupyter Notebook |
| **Statistical Visualizations** | Matplotlib, Seaborn |
| **3D Graphics & Engine** | Three.js (WebGL), OrbitControls, GLTFLoader |
| **Interactive Dashboard** | Chart.js, Vanilla JavaScript (ES6+), Modern CSS3 |

---

## 🔬 Mathematical Formulas & Feature Engineering

1. **Theoretical Single-Precision Compute Performance (FP32 TFLOPS):**
   $$\text{TFLOPS} = \frac{2 \times \text{CUDA Cores} \times \text{Boost Clock (MHz)}}{1,000,000}$$

2. **Price-to-Performance Value Score ($ / TFLOPS):**
   $$\text{Cost per TFLOPS} = \frac{\text{Market Price (USD)}}{\text{FP32 TFLOPS}}$$
   *(Lower is better — indicates higher compute yield per dollar spent)*

3. **Compute Efficiency (Perf-per-Watt):**
   $$\text{Efficiency} = \frac{\text{TFLOPS}}{\text{TDP (Watts)}}$$

---

## 📈 Key Findings from the Analysis

* **The Enthusiast Tax (Diminishing Returns):** While flagship halo cards like the **RTX 5090 (104.75 TFLOPS)** and **RTX 4090 (82.58 TFLOPS)** deliver unprecedented performance, their cost efficiency rises above **$19–21 / TFLOPS**.
* **The Value Sweet Spot:** The upper-midrange tier—spearheaded by the **RTX 4070 SUPER ($16.88 / TFLOPS)** and **RTX 4060 Ti ($17.63 / TFLOPS)**—delivers the highest compute efficiency per dollar for gaming and consumer AI workloads.
* **Correlations:** CUDA Core count exhibits the strongest correlation with price ($r = 0.88$) and compute capability, while clock speeds level off around 2.4–2.6 GHz across modern nodes.

---

## 📁 Repository Structure

```text
gpu-explorer/
├── gpu_data_analysis.ipynb   # Executed Jupyter Notebook with all charts & analysis
├── pipeline.py               # Standalone Python CLI script for ETL & verification
├── nvidia_gpus_clean.csv     # Verified clean dataset (46 desktop GPUs)
├── index.html                # Main 3D GeForce Explorer web app
├── style.css                 # NVIDIA-inspired dark graphite & green styling
├── app.js                    # Three.js 3D engine & Chart.js visualizer
├── dataset.js                # Client-side data object for web UI
└── README.md                 # Project documentation
```

---

## 🚀 How to Run the Python Analysis Locally

1. **Clone the repository:**
   ```bash
   git clone https://github.com/francisjordan/geforce-3d-explorer.git
   cd geforce-3d-explorer
   ```

2. **Install dependencies:**
   ```bash
   pip install pandas numpy matplotlib seaborn jupyter
   ```

3. **Run the Python pipeline script:**
   ```bash
   python pipeline.py
   ```

4. **Launch the interactive Jupyter Notebook:**
   ```bash
   jupyter notebook gpu_data_analysis.ipynb
   ```

---

## 👤 Author

**Francis Jordan Hasnawi**  
*Computer Science (Database Technology) — Binus University*  
* Aspiring Data Analyst & Computational Enthusiast  
* [LinkedIn](https://linkedin.com/in/francis-jordan-hasnawi) | [GitHub](https://github.com/francisjordan)
