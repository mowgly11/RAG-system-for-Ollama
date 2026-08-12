export default function returnCreator(error: string | null, data: any = null) {
    return {
        error,
        data
    }
}