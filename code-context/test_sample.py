class DataProcessor:
    def __init__(self, data):
        self.data = data

    def clean(self):
        return [d.strip() for d in self.data]

def load_data(filepath):
    print("Loading data...")
    return []

def main():
    data = load_data("input.txt")
    processor = DataProcessor(data)
    processor.clean()