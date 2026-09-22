print("Welcome to Vic Chatbot! I am your AI assistant.")

while True:
    question = input("You: ")

    if question.lower() == "exit":
        print("Vic Chatbot: Goodbye!")
        break

    print("Vic Chatbot: I received your question:", question)
    