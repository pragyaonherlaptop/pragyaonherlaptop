CXX      = g++
CXXFLAGS = -std=c++17 -O3 -march=native -Wall -Wextra -DNDEBUG -pthread

SRC := $(wildcard src/*.cpp)
OBJ := $(SRC:src/%.cpp=build/%.o)
HDR := $(wildcard src/*.h)

chesstrel: $(OBJ)
	$(CXX) $(CXXFLAGS) $(OBJ) -o $@

build/%.o: src/%.cpp $(HDR) | build
	$(CXX) $(CXXFLAGS) -c $< -o $@

build:
	mkdir -p build

test: chesstrel
	./chesstrel test

clean:
	rm -rf build chesstrel chesstrel.exe

.PHONY: test clean
